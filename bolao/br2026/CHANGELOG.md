# Bolão Brasileirão 2026 — CHANGELOG

## v1.20 — 2026-07-13

### Fixed — fechamento da tarefa "Copa como referência canônica"

- `.admin-toolbar` gap/margin alinhados com a Copa (`8px`/`14px`, era `6px`/`8px`).
- `.admin-row` (lista de entradas/pagamentos no admin) **mantido** como lista densa em vez de
  virar um card por linha como a Copa — decisão consciente registrada em
  `docs/bolao/CONSISTENCY_MATRIX.md` item 78 (densidade de dados + área admin-only de baixa
  visibilidade), não uma omissão.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a tabela de mapeamento completa desta rodada e a
tabela de validação (com a ressalva de que não houve captura visual real — sem navegador
disponível neste sandbox, tudo verificado por leitura de CSS).

`audit_scoring.py`: 5/5 — só CSS.

## v1.19 — 2026-07-12

### Fixed — bugs reais reportados testando o site ao vivo

- **Tabela do Brasileirão sem V/E/D/GF/GC/SG**: `fetchStandings()` só extraía
  `points`/`gamesPlayed`/`gf`/`ga` da ESPN. Adicionado `wins`/`ties`(`draws`)/`losses`/
  `pointDifferential` (nomes de stat confirmados direto no endpoint real da ESPN) e as colunas
  correspondentes na tabela — padrão J/V/E/D/GP/GC/SG/Pts de tabela de futebol brasileiro.
- **Jogos não alinhavam**: `.game-matchup` era `flex` com `justify-content:center` — o placar/
  hora central não ficava na mesma posição horizontal entre linhas com nomes de time de
  tamanhos diferentes, porque flex empacota pelo conteúdo. Trocado para grid `1fr auto 1fr`
  (mesmo padrão de `.game-teams` na Copa), forçando as duas colunas de time a terem a mesma
  largura — o centro sempre alinha agora, independente do tamanho do nome.
- **Botão WhatsApp**: texto visível era só "WhatsApp"; Copa usa "Suporte WhatsApp". Alinhado.
- **Card de pagamento sem ícone**: `.pay-card` não tinha o ícone por método (CashApp/Zelle/
  Venmo) que a Copa tem — `cashapp.svg`/`venmo.svg` copiados para `assets/`, `payIcon()`
  portado, `zelle.qrImage` configurado (asset já existia). `.pay-grid`/`.pay-card` migrados
  para o mesmo layout/tokens da Copa (3 colunas fixas, ícone + texto em linha, `var(--bg2)`/
  `border-radius:16px`).
- **Spinner nativo removido** dos inputs numéricos (mesmo fix nos três apps).

`audit_scoring.py`: 5/5 — só CSS/apresentação, nenhum dado de standings usado para
scoring/ranking (BR2026 não pontua pela tabela do Brasileirão em si, só pelos palpites de
G4/Z4/SA6 dos participantes).

## v1.18 — 2026-07-12 (WIP — commit parcial)

### Fixed — Copa como referência visual canônica (início; tarefa incompleta)

Início da padronização com a Copa (`bolao/`) como referência visual canônica (nova regra
permanente em `CLAUDE.md`). Commit parcial por limitação de créditos da sessão — ver
`docs/bolao/CONSISTENCY_MATRIX.md`/`DESIGN_SYSTEM.md` para o que ainda falta (auditoria
completa de jogos/times, admin, pagamento, regras, e a tabela de validação visual por
viewport pedidas na tarefa não foram concluídas).

- **`main` max-width**: `860px` → `1140px`, igual à Copa.
- **`.game-card`**: era uma linha de lista plana (só `border-bottom`); agora usa o mesmo
  tratamento de card da Copa (`background`, `border`, `border-radius:16px`, `margin-bottom`).

`audit_scoring.py`: 5/5 — só CSS.

## v1.17 — 2026-07-12

### Added — sistema de toast + badge/status unificado + ranking reestruturado (findings Critical/High autorizados)

Autorização explícita do Eduardo para implementar os 3 findings maiores do
`docs/bolao/DESIGN_SYSTEM.md` que ficaram pendentes na rodada anterior (patch mínimo só CSS).
Ver `docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69 e `bolao/CHANGELOG.md` v4.127.

- **Badge/status unificado**: `.game-status` deixou de ser só texto colorido e virou pílula
  (`border-radius:999px; padding:4px 10px`), mesmo tratamento do `.status-chip` da Copa —
  adicionado `.game-status.live` com a mesma animação de pulso (`@keyframes live-pulse`,
  copiado da Copa, não existia aqui). `.paid-badge`/`.unpaid-badge` ganharam
  `border-radius:999px`/`padding:4px 10px`/`font-weight:900` (eram `6px`/`3px 8px`/`700`).
- **Sistema de toast portado da Copa**: `showToast()` (mesma implementação, copiada de
  `bolao/js/app.js`) + CSS `.bolao-toasts`/`.bolao-toast` (4 variantes: success/error/warn/
  info). Convertidos os `alert()`s de confirmação/erro que não são validação de formulário
  (fluxo de salvar entrada, admin login/lockout, sync, resultados) — validação de campo
  obrigatório continua `alert()`, de propósito, igual à Copa.
- **Ranking reestruturado**: `.rank-card` empilhado (com o detalhe de palpites sempre visível)
  substituído pelo `.rank-row` denso de 1 linha da Copa + `.picks-detail` expansível por clique
  (`data-rank-toggle`/`_openRankDetails`, mesmo padrão de `bolao/js/app.js`). Card de posição/
  nome/pontos/badge de pagamento/botão "Ver palpites" numa linha só; detalhe dos palpites some
  por padrão, mesmo comportamento em mobile (breakpoint 900px com coluna de pontos de largura
  fixa, já usado na Copa desde as rodadas de otimização documentadas em `LESSONS_LEARNED.md`).
- Nova chave i18n: `viewPicks`.

`audit_scoring.py`: 5/5 — mudança é de apresentação/interação, nenhuma fórmula de pontuação ou
critério de desempate foi tocado (o `scored.sort()` que já existia continua idêntico).

## v1.16 — 2026-07-12

### Fixed — patches mínimos de design system (auditoria de UX cross-app)

Parte dos findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md`, CSS-only:

- **`h1,h2,h3` normalizado globalmente** — antes só existia `.section-head h2`; um `<h3>` fora
  dessa seção (ex.: dentro de um `.card`) caía no tamanho/margem default do navegador,
  diferente da Copa. Mesma regra da Copa portada (`margin:.15em 0 .4em`, `h2:1.25rem`,
  `h3:1.05rem` — sem `h1` explícito, a Copa também não tem).
- **Botão sticky (`.sticky-submit button`)**: sombra `rgba(0,0,0,.5)` → `rgba(47,229,110,.35)`
  (verde, igual à Copa) — `min-width:200px` já existia.
- Input/select/label e `.rules-table` padding já batiam com a Copa antes desta rodada — nenhuma
  mudança necessária aqui (a Copa que migrou para o padrão que este app já tinha).

Findings maiores (badge/status, ranking, toast) não implementados nesta rodada — ver
`bolao/CHANGELOG.md` v4.126 para o racional completo.

`audit_scoring.py`: 5/5 (só CSS).

## v1.15 — 2026-07-12

### Fixed — escudo do time renderizando em tamanho gigante (bug real do fix de v1.14)

Reportado por Eduardo testando o site ao vivo: o fix de v1.14 (escudo no card "Ao vivo"/
"Próximo jogo") usava `teamLogoImg()` gerando `<img class="team-logo">` sem `width`/`height` —
e a classe `.team-logo` no CSS também não tinha essas dimensões definidas (os usos antigos, nas
barras de probabilidade, tinham `width="14" height="14"` como atributo HTML inline direto,
mascarando a lacuna). Resultado: o navegador renderizava a imagem no tamanho nativo do arquivo
da ESPN (bem maior que 14px) nos dois cards novos. Corrigido adicionando `width:14px;
height:14px` diretamente à classe `.team-logo` no CSS — cobre todos os usos, novos e antigos,
sem depender de atributo inline em cada `<img>`.

`audit_scoring.py`: 5/5 (só CSS).

## v1.14 — 2026-07-12

### Fixed — escudo do time só aparecia na barra de probabilidade, não no card do jogo

Reportado por Eduardo: o escudo do time (`_teamLogos`, vindo do standings da ESPN) já era
buscado e usado dentro das barrinhas de probabilidade, mas os dois widgets mais visíveis da
tela — o card "Ao vivo" (`renderLiveCard`) e o card "Hoje tem jogo"/"Próximo jogo"
(`renderNextGameCard`, nos 3 estados: ao vivo, encerrado hoje, e sem jogo hoje) — mostravam só
o nome do time em texto puro, sem nenhum símbolo. A aba Jogos (`renderGamesSection`) já
mostrava o escudo corretamente ao lado do nome — só os widgets do topo da página estavam sem.

- Extraído helper `teamLogoImg(team, cls)` reaproveitando `_teamLogos` (já existente).
- Escudo adicionado nas bordas externas dos nomes de time (mesmo padrão visual da Copa com
  bandeira) em `renderLiveCard`, `renderNextGameCard` (todos os 3 estados) e
  `renderNextGameCard`'s "próximo jogo" (sem jogo hoje).
- Só CSS/markup — nenhuma lógica de scoring, ranking ou dado alterada. `audit_scoring.py`: 5/5.

### Added — botão WhatsApp no topbar

Resolve a divergência `MISSING` catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34 —
reaproveita o mesmo grupo, QR e ícone da Copa do Mundo (`assets/whatsapp.svg`,
`assets/whatsapp-group-qr.png`), não é um grupo novo.

## v1.13 — 2026-07-12

### Fixed — CSS badge para jogos adiados

- `.game-status.postponed { color: var(--gold); }` adicionado (texto "Adiado" em dourado)
- Completa implementação de detecção de jogos adiados via ESPN (`status.type.name === "Postponed" || "Canceled"`)
- `audit_scoring.py`: 5/5.

---

## v1.12 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

## v1.11 — 2026-07-12

### Fixed — alinhamento topbar + cutoff atualizado

- `align-items: center` no grid do topbar (desktop e mobile)
- `cutoffIso` atualizado para **domingo 19/jul às 23h59 BRT** (2 dias antes do reinício do Brasileirão)
- `audit_scoring.py`: 5/5.

---

## v1.10 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.9 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

11 diferenças identificadas por auditoria diff completa dos 3 CSS/HTML. Todas corrigidas:

- **Nav**: convertido de `flex-wrap` para `grid repeat(9, 1fr)` — botões sempre com largura uniforme, idêntico à Copa
- **Topbar responsivo**: adicionados breakpoints `@media ≥901px` e `≤900px` — topbar vira grade de 2 linhas (brand+switcher em cima, nav em baixo) igual à Copa
- **Card**: `border-radius 16px → 18px`, `padding 18px 20px → 18px`, `margin-bottom 16px → 14px`, adicionado `box-shadow 0 8px 32px rgba(0,0,0,.22)`
- **Countdown**: `.count-card` ganhou `background var(--bg3)`, `border`, `border-radius 16px`, `padding 16px`; `.count-grid` virou `grid repeat(4, 1fr)`; células `background var(--bg)`, `border-radius 12px`; números agora em `color: var(--green)`, `font-size 26px`
- **Brand gap**: `6px → 8px`
- **Footer**: `margin-top 32px`, `opacity .6`, `border-top var(--border2)`, `user-select none`, links com hover
- **Focus ring**: adicionado `button/input/select:focus-visible` (acessibilidade)
- **Mobile `≤500px`**: `count-grid` vira 2 colunas no celular

`audit_scoring.py`: 5/5.

---

## v1.8 — 2026-07-11

### Fixed
- **Auto-sync não apaga mais o formulário**: setInterval de 30s agora verifica `document.hidden || _editingEntry` antes de chamar `renderAll()` — usuário preenchendo palpites não perde os dados no meio
- **Email throttle**: `br2026_emailTs` agora só é gravado no sessionStorage *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, falha de rede consumia o throttle silenciosamente.
- **Flash de seção errada**: `<section id="entry">` não tem mais `class="active"` no HTML — o Ranking abre instantaneamente (prazo já encerrado) sem flash do form de palpites
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados — pill estilizado funciona no iPhone agora

## v1.7 — 2026-07-11

### Changed
- **Jogos — layout centralizado**: card de partida agora exibe `Nome | Bandeira | Score | Bandeira | Nome` em fileira única centrada — nada para a esquerda ou direita. Linha `.game-meta` (status/partida/venue) também centralizada

## v1.6 — 2026-07-11

### Added
- **Dropdown bolão-switcher**: header agora tem `<select>` para navegar entre Copa do Mundo, Brasileirão 2026 e Copa do Brasil 2026 sem voltar para a página principal

### Changed
- **Jogos — novo layout de partidas**: cards de jogo agora usam CSS Grid `1fr auto 1fr` com logos ESPN em cada lado — times nunca quebram linha no mobile ou no desktop. Nomes longos ficam truncados com reticências. Venue/status/número da partida consolidados numa única linha `.game-meta` abaixo do placar
- **Ranking — tiebreaker Z→A**: quando tudo mais empata, a ordenação de exibição agora é Z→A (igual à Copa v4.105) em vez de A→Z — sem mudança de posição/medalha
- **Seção padrão = Ranking**: `init()` abre direto no Ranking quando o prazo já passou (`isPastCutoff()`), em vez de sempre abrir Palpites
- **document.hidden guard**: ticker de 1s (`renderLiveCard` / `renderNextGameCard`) agora pula quando a aba está em background — elimina setInterval desnecessário
- **mergeStates `preferRemoteResults`**: `loadRemoteState()` agora passa `{ preferRemoteResults: true }` para que resultados do Supabase sempre sobrescrevam o cache local ao sincronizar (equivalente ao Copa v4.108)
- **Auto-sync 30s**: quando `database.enabled: true`, sincroniza com Supabase a cada 30s automaticamente

## v1.5 — 2026-07-02

### Added / Changed
- **Dixon-Coles IPF**: estimação de ataque/defesa por Iterative Proportional Fitting (50 iterações, decaimento exponencial de 10 jogos) — substitui médias simples de gols
- **Dixon-Coles ρ correction** (ρ=−0.13): ajuste de probabilidades em placar 0-0/1-0/0-1/1-1 aplicado ao `matchProb`
- **expectedGoals dual-mode**: modo IPF quando há dados suficientes; fallback com LG_AVG no início de temporada
- **Hero card — barras de prob pré-jogo**: jogos agendados do dia e card do próximo jogo mostram barras visuais de probabilidade com logos
- **Jogos — "Partida N"**: número sequencial em cada card de jogo; logo agora aparece após o nome do time

## v1.4 — 2026-07-02

### Added
- **Logos ESPN nos jogos**: escudos dos clubes carregados da API ESPN (CSP atualizada para `https://a.espncdn.com`)
- **Jogos de hoje**: card do próximo jogo substituído por lista de todos os jogos do dia atual — jogos ao vivo destacados, encerrados em cinza, próximos com countdown
- **Auto-scroll Jogos**: ao clicar na aba Jogos, a lista rola até o próximo jogo agendado
- **Título corrigido**: browser tab agora mostra "Bolão do Ferrari — Brasileirão 2026"

### Changed
- **Barras de probabilidade pré-jogo**: Jogos agendados mostram barras visuais coloridas com nome dos times (substituiu texto "Casa X% · Emp Y% · Fora Z%")
- **Nav buttons**: estilo igual ao da Copa (fundo sólido, verde no ativo)
- **Botão Recalcular**: aparece mesmo durante "Calculando..." para permitir retry
- **Monte Carlo GD corrigido**: GD agora determinado pelos gols amostrados `hg/ag` (não por comparação independente com `pH`) — resultados estatisticamente coerentes
- **buildRatings cacheado**: recalculado só quando standings atualizam, não a cada segundo

### Fixed
- **Monte Carlo fim de temporada**: quando não há jogos restantes, retorna classificação final determinística (100%/0%) em vez de estado "Calculando..." permanente
- **prob-bar-mini px→%**: barras na tabela de probabilidades agora escalam corretamente (era `width:${n}px`, correto é `width:${n}%`)
- **buildRatings floor**: ataque/defesa mínimo de 0.3× para evitar P(Emp)=100% em times com `gf=0`
- **matchProb normalizado**: probabilidades somam exatamente 100%
- **ARIA**: `scope="col"` nos th, `aria-hidden="true"` nas barras decorativas, `role="group"` nas prob-bars
- **scheduleMC debounce**: `_mcTs` atualizado antes do setTimeout para evitar enfileiramento duplo

## v1.3 — 2026-07-02

### New features
- **Probabilidades tab**: new nav section with Poisson + Monte Carlo (2 000 simulations) championship probability table — P(G4) / P(Sul-Am.) / P(Rebaixado) per team, sorted by G4 probability, with color-coded mini bars and a Recalcular button
- **In-play probability bars**: when a match is live the card now shows animated win/draw/loss probability bars computed from in-play Poisson adjusted for time remaining and current scoreline
- **Per-match probability hints**: upcoming (pre) games in the Jogos section now show "Casa X% · Emp Y% · Fora Z%" hint lines derived from the same Poisson model
- **Poisson model**: `buildRatings()` / `expectedGoals()` / `matchProb()` / `inPlayProb()` / `runMonteCarlo()` — all pure vanilla JS, no external libraries
- **fetchStandings() extended**: now also parses `gamesPlayed`, `pointsFor`, `pointsAgainst` from ESPN stats array (needed for attack/defence ratings)
- **Match prob cache**: `_matchProbs` object caches per-fixture win/draw/loss probs; cleared on each standings poll so ratings stay fresh

## v1.2 — 2026-07-02

### Bug fixes (post mega-audit)
- **fix(timezone)**: remove `toBRT()` manual UTC-3 offset arithmetic; replace with `{ timeZone: "America/Sao_Paulo" }` in all `toLocale*` calls — was showing wrong times for users outside Brazil
- **fix(tiebreaker)**: `renderRanking()` now uses officially locked G4/Z4 results for tiebreakers when `results.locked === true`, instead of live ESPN standings that may differ
- **fix(live-overlay)**: `pollAll()` now updates ALL scoreboard matches (including post-game) in `_schedule` cache, preventing finished games from staying "Ao vivo" until TTL expires
- **fix(admin-validation)**: `saveResultsBtn` now validates SA6 ↔ G4 and SA6 ↔ Z4 overlap, preventing double-scoring for a team appearing in two zones
- **fix(emailjs-throttle)**: `sendReceipt()` now honours `C.emailjs.limitRateMs` (30s) via sessionStorage — the config value was defined but never enforced
- **fix(cache-key)**: schedule sessionStorage key is now versioned (`br2026_schedule_v1.2`) to prevent stale schema reads after version bumps
- **fix(a11y)**: removed `aria-live="polite"` from countdown div — was causing screen readers to announce every second tick

## v1.1 — 2026-07-02

### New features
- **Sul-Americana picks**: 6 team dropdowns (positions 7–12), 8 pts per correct pick — mutual exclusion with G4/Z4
- **Jogos calendar**: full 382-game Brasileirão schedule from ESPN, grouped by BRT date with venue/city; live games overlay real-time scores
- **Next game card**: countdown to next scheduled game with venue; shows live score if a match is in progress
- **Tiebreakers**: SA6 hits → G4 exact positions → Z4 exact positions
- **Standings SA zone**: rows 7–12 highlighted in amber with SA badge
- **Language**: removed es and en-US — BR2026 is pt-BR only
- **Admin results**: 3-column grid (G4 / Sul-Am. / Z4), ESPN auto-fill covers all zones
- **Rules**: updated scoring table (max 176 pts) with tiebreaker list

## v1.0 — 2026-07-02

### Initial release
- G4 (top 4, in order) + Z4 (bottom 4, in order) picks
- 8 dropdowns with mutual-exclusion validation (no team can appear twice or in both G4/Z4)
- Provisional scoring from live ESPN standings throughout the season
- Standings card with ESPN Brasileirão (bra.1) live table — polls every 60s
- Live match card when a Brasileirão match is in progress
- Admin: lock official result at season end, or fill from current ESPN standings
- Admin: payment tracking, entry edit/delete, CSV export
- Email receipt on save (EmailJS, same templates as Copa bolão)
- 3-language support: pt-BR, es, en-US
- Supabase integration ready (set `database.enabled: true` after creating row `id='br2026'`)
- Not published yet (no link from main site)
