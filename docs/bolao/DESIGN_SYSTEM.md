# Design System — Plataforma Bolão

Especificação oficial de interface para os três aplicativos (`bolao/`, `bolao/br2026/`,
`bolao/cdb2026/`). Este documento é o resultado de uma auditoria de UX comparativa entre os
três apps (2026-07-12) — ver `docs/bolao/CONSISTENCY_MATRIX.md` para o histórico item a item, e
`docs/bolao/LESSONS_LEARNED.md` para os bugs de UI já corrigidos no passado.

**Método da auditoria** — leitura completa e comparação linha a linha dos três arquivos
`css/styles.css` e `index.html`, com verificação cruzada de todas as ocorrências de cada
componente (regra permanente em `CLAUDE.md`: "toda vez que um componente visual for alterado").
**Limitação registrada:** este sandbox não tinha extensão de navegador conectada no momento da
auditoria — não foi possível capturar screenshots reais em Safari/Chrome nos 8 breakpoints
pedidos. Toda medida abaixo vem do CSS/HTML real (portanto é exata e verificável — `grep` no
próprio repositório reproduz qualquer valor citado), mas julgamentos que dependem só de olhar a
tela renderizada (ex.: "está feio", cor exata percebida em um monitor real) não foram feitos.
Recomendo uma passada visual manual (`python3 -m http.server 8080`, abrir os três apps) antes de
aceitar qualquer correção "Low"/"Medium" cosmética como definitiva.

Os três apps compartilham o mesmo sistema de tokens de cor (CSS custom properties):

```css
--bg: #07141b;       --bg2: #0d2028;      --bg3: #10252d;
--border: #1f3b45;   --border2: #29444d;
--green: #2fe56e;    --green-dk: #03130b;
--text: #eef7f1;     --muted: #9cb2b9;
--danger-bg: #3d1520; --danger-tx: #ffdbe1; --danger-br: #8e2d42;
```
Copa adiciona `--gold` não existe (usa hex direto em vários lugares — ver "Inconsistências").
BR2026/CDB2026 adicionam `--gold: #f59e0b;` `--red: #f87171;`. **Copa não tem esses dois
tokens** — onde precisa de dourado/vermelho usa hex literal espalhado pelo CSS
(`#f59e0b`, `#ff6b6b`, `#4a0e0e`...). Isso já é uma inconsistência de fundação — ver item 1 da
lista de inconsistências no final.

---

## Botão Primary

```css
border: 0;
border-radius: 12px;
padding: 11px 18px;
background: var(--green);
color: var(--green-dk);
font-weight: 900;
cursor: pointer;
transition: opacity .15s;
/* hover */    opacity: .88;
/* disabled */ opacity: .45; cursor: not-allowed;
```
Sem sombra própria (sombra só aparece no contexto `.sticky-submit button`, ver "Sticky Action").
Sem animação além do `transition: opacity .15s` no hover.

**Status:** byte-a-byte idêntico nos três apps. ✅ Nenhuma ação necessária.

## Botão Secondary

```css
background: var(--bg3);
color: var(--text);
border: 1px solid var(--border2);
/* herda o resto do Primary: border-radius 12px, padding 11px 18px, font-weight 900 */
```
**Status:** idêntico nos três apps. ✅

## Botão Danger

```css
background: var(--danger-bg);
color: var(--danger-tx);
border: 1px solid var(--danger-br);
```
**Status:** idêntico nos três apps. ✅ Uso na UI diverge — ver inconsistência #7 (botão "Limpar
tudo" existia só na Copa até esta sessão; agora existe também no CDB2026, ainda falta no
BR2026).

## Botão Small

```css
padding: 7px 11px;
font-size: 12px;
border-radius: 9px;
white-space: nowrap;
```
**Status:** idêntico nos três apps. ✅ Densidade de uso diverge (Copa: 12 ações no admin
toolbar; BR2026: 3 — CSV/Sync/[JSON quando existir]; CDB2026: 4 — CSV/JSON/Sync/Limpar). Isso
não é um bug de componente, é uma lacuna de feature já catalogada (`CONSISTENCY_MATRIX.md`
item 6).

---

## Input

| Propriedade | Copa | BR2026 / CDB2026 | Divergência |
|---|---|---|---|
| `background` | `var(--bg)` (mais escuro) | `var(--bg3)` (mais claro) | **Sim — cor de fundo do campo diferente** |
| `border-radius` | `11px` | `9px` | **Sim** |
| `padding` | `11px 12px` | `10px 12px` | Sim (1px, imperceptível sozinho) |
| `border` | `1px solid var(--border2)` | idêntico | — |
| `width` | `100%` | idêntico | — |
| Espaçamento do label | `margin-top: 5px` no próprio input | `gap: 5px` no `label` flex | Efeito visual igual, mecanismo diferente |
| Foco (clique/mouse) | `outline: 2px solid var(--green)` | `border-color: var(--green)` (sem outline) | **Sim — anel de foco visível só na Copa em clique de mouse** |
| Foco (teclado, `:focus-visible`) | `outline: 2px solid #2fe56e; outline-offset: 3px` | idêntico | — |
| `disabled` | `input[disabled] { opacity: .5 }` | `input:disabled { opacity: .5; cursor: not-allowed }` | BR2026/CDB2026 também mudam o cursor; Copa não |

**Especificação recomendada (canônica):**
```css
label { display: flex; flex-direction: column; gap: 5px; }
label span { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
input, select, textarea {
  width: 100%;
  background: var(--bg3);
  border: 1px solid var(--border2);
  border-radius: 9px;
  padding: 10px 12px;
  color: var(--text);
  outline: none;
  transition: border-color .15s;
}
input:focus, select:focus, textarea:focus { border-color: var(--green); }
input:disabled, select:disabled, textarea:disabled { opacity: .5; cursor: not-allowed; }
```
Motivo da escolha: 2 dos 3 apps já usam este padrão; o anel de `outline` no foco por mouse da
Copa é redundante com o `:focus-visible` global que os três já têm — manter os dois é
inconsistente sem ganho de acessibilidade real (o `:focus-visible` já cobre o caso que importa,
navegação por teclado).

## Textarea

**Nenhum dos três apps usa `<textarea>` em nenhum lugar da UI atual** — não há campo de texto
livre multi-linha em nenhum formulário (motivo de negócio, delete de entrada usa `prompt()`
implícito no fluxo, não textarea). Especificação acima serve de base para quando um for
necessário; não há inconsistência a corrigir hoje porque o componente não existe ainda.

## Select

Mesma regra do Input (`input, select { ... }` é uma única declaração combinada nos três apps).
Diferença adicional: `.bolao-switcher select` e os dropdowns de palpite (`.pick-select`,
`.tie-advance`) têm `appearance: none` — confirmado idêntico nos três apps.

---

## Card

```css
background: var(--bg2);
border: 1px solid var(--border);
border-radius: 18px;
padding: 18px;
margin-bottom: 14px;
box-shadow: 0 8px 32px rgba(0,0,0,.22);
```
**Status:** idêntico nos três apps, byte-a-byte. ✅

## Section

Container `<section id="..." class="page">` com `display:none` por padrão, `.page.active {
display:block}`. Idêntico nos três apps. Cabeçalho de seção (`.section-head`) também
idêntico em estrutura, mas a tipografia do `<h2>` dentro dele diverge — ver "Header" abaixo.

---

## Header (h1/h2/h3)

| | Copa | BR2026 / CDB2026 |
|---|---|---|
| Regra global | `h1,h2,h3 { margin:.15em 0 .4em }` / `h2{font-size:1.25rem}` / `h3{font-size:1.05rem}` | **Nenhuma regra global** — só `.section-head h2 { margin:0 0 4px; font-size:22px }` |
| `<h3>` fora de `.section-head` (ex.: dentro de cards, títulos de admin) | `1.05rem` (~16.8px), margem apertada | **Tamanho e margem default do navegador** (`~1.17em`, margem grande) |

**Esta é uma inconsistência real de hierarquia visual**, não cosmética: qualquer `<h3>` dentro
de um `.card` (ex.: "Resultado final", "Pagamentos" no admin do CDB2026; "Como funcionam os
simuladores?" na Copa) renderiza em tamanhos e espaçamentos verticais diferentes dependendo do
app, porque só a Copa normaliza isso globalmente.

**Especificação recomendada (canônica, para os três apps):**
```css
h1, h2, h3 { margin: .15em 0 .4em; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.05rem; }
.section-head h2 { margin: 0 0 4px; font-size: 22px; } /* overrides local ao header de seção */
```

---

## Table

Não existe uma classe `.table` genérica em nenhum app — cada tabela tem sua própria classe:

| Tabela | App | `border-collapse` | `padding` da célula | Borda de linha |
|---|---|---|---|---|
| `.rules-table` | Copa | `collapse` | `8px 10px` | `1px solid var(--border)` |
| `.rules-table` | BR2026 | `collapse` | `7px 10px` | idêntico |
| `.rules-table` | CDB2026 | `collapse` | `7px 10px` | idêntico |
| `.picks-detail table` | Copa (só Copa — sem equivalente nos outros dois) | `collapse` | `7px 8px` | `1px solid var(--border)` |
| `.prob-table` | Copa (só Copa) | `collapse` | `6-7px 8px` | idêntico |

**Divergência real:** `.rules-table` tem `8px 10px` de padding na Copa e `7px 10px` em
BR2026/CDB2026 — 1px, imperceptível isoladamente, mas é o mesmo padrão do input (Copa
sistematicamente 1px "maior" em paddings verticais) — sugere que a Copa nunca foi re-alinhada
depois que BR2026/CDB2026 nasceram como cópia dela e divergiram.

**Mobile:** nenhuma tabela tem uma estratégia de scroll horizontal (`overflow-x:auto`) própria
— exceto `.picks-detail { overflow-x: auto }` na Copa. `.rules-table` (a única tabela presente
nos três apps) tem só 2 colunas curtas ("Acerto" / "Pts"), então não quebra em mobile na
prática — mas isso é sorte de conteúdo, não uma garantia estrutural do componente.

**Especificação recomendada:**
```css
.table-wrap { overflow-x: auto; margin-bottom: 10px; } /* wrapper obrigatório para QUALQUER tabela nova */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; }
th { color: var(--muted); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
```

---

## Badge / Status indicator

**Esta é a maior inconsistência de componente encontrada na auditoria.** Três apps, três
tratamentos visuais completamente diferentes para o mesmo conceito ("indicador de estado"):

| App | Classe | Formato | Cor |
|---|---|---|---|
| Copa | `.status-chip.done/.pending/.live` | Pílula preenchida (`border-radius:999px; padding:4px 10px`) | Hex literal (`#143d22`/`#72ff9d`, `#4a0e0e`/`#ff6b6b`) — **não usa `var(--green)`/`var(--red)` nem token nenhum** |
| BR2026 | `.game-status.live/.post/.pre/.postponed` | **Texto colorido puro, sem fundo, sem borda, sem padding** | `#ef4444` / `var(--muted)` / `var(--gold)` |
| BR2026/CDB2026 | `.paid-badge` / `.unpaid-badge` | Pílula translúcida com borda (`background:rgba(...)`, `border-radius:6px`) | `var(--green)`/`var(--red)` via `rgba()` |
| CDB2026 | (sem equivalente a `.game-status` — jogos não têm chip de "ao vivo/finalizado" nenhum, só mostram o placar quando existe) | — | — |

Três formatos de badge (pílula preenchida sólida / texto puro sem fundo / pílula translúcida
com borda) para o mesmo papel semântico, mais um app (CDB2026) sem badge de status de jogo
nenhum. Nenhum dos três usa uma variável de cor semântica (`--success`, `--danger`,
`--warning`) — todos misturam `var(--green)`/`var(--red)`/`var(--gold)` com hex literal
ad-hoc.

**Especificação recomendada (canônica):**
```css
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 999px; padding: 4px 10px;
  font-size: 11px; font-weight: 900; white-space: nowrap;
}
.badge-success { background: rgba(47,229,110,.15); color: var(--green); border: 1px solid rgba(47,229,110,.3); }
.badge-danger  { background: rgba(248,113,113,.12); color: var(--red);   border: 1px solid rgba(248,113,113,.28); }
.badge-warning { background: rgba(245,158,11,.15);  color: var(--gold);  border: 1px solid rgba(245,158,11,.3); }
.badge-neutral { background: var(--bg3); color: var(--muted); border: 1px solid var(--border2); }
.badge-live    { background: #4a0e0e; color: #ff6b6b; animation: live-pulse 1.6s ease-in-out infinite; }
```
`.paid-badge`/`.unpaid-badge`/`.status-chip`/`.game-status` deveriam todos ser reescritos em
cima de `.badge` + um modificador semântico — hoje são 4 implementações paralelas do mesmo
componente.

---

## Alert

Não existe um componente `.alert` genérico. O que existe, espalhado:
- `.warning` (Copa only): fundo amarelo claro `#fff4cc`, texto escuro `#392d00` — **é o único
  lugar em toda a plataforma com tema claro dentro de uma UI 100% escura** (contraste correto
  isoladamente, mas visualmente destoa muito do resto — parece um elemento de outro site).
- `.edit-mode-banner` (Copa only): fundo `#fff9c4`, mesma família de tema claro isolado.
- `.bolao-toast.warn/.error/.success/.info` (Copa only — BR2026/CDB2026 usam `alert()`/
  `confirm()` nativos do navegador para tudo, sem sistema de toast).
- Nenhum "Alert" de card inline em BR2026/CDB2026 — mensagens de erro de validação vão direto
  para `alert()` nativo (bloqueante, feio, mas funcional).

**Inconsistência real:** BR2026/CDB2026 não têm o sistema de toast que a Copa construiu
especificamente para reduzir `alert()`s bloqueantes (ver `LESSONS_LEARNED.md` → "QA" e
histórico de v4.82 no changelog da Copa). Isso é uma regressão de UX nos dois apps novos em
relação ao padrão que a própria plataforma já validou como melhor.

**Especificação recomendada:** portar `.bolao-toast` (Copa) para BR2026/CDB2026 tal como está —
já é o componente correto, só não foi propagado.

---

## Header (topbar/navbar)

```css
.topbar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(7,20,27,.94);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 10px 18px;
}
```
Idêntico nos três apps, incluindo o grid responsivo (`brand | whatsapp | lang-links |
switcher` na linha 1, `nav` full-width na linha 2, `min-width:901px`). **Status:** consistente
✅ — inclusive depois desta sessão, quando o botão WhatsApp foi propagado para os três.

Única diferença real: número de itens no `.nav` (Copa 8, BR2026 9, CDB2026 7) — consequência
direta do número de seções de cada app, não um bug.

## Footer

`.site-footer-bar` — idêntico nos três apps (mesma tipografia, padding, `opacity:.6`).
**Status:** consistente ✅.

## Sticky Action

```css
.sticky-submit {
  position: sticky; bottom: 12-14px; z-index: 6-10;
}
.sticky-submit button {
  box-shadow: 0 4px 24px rgba(47,229,110,.35); /* só a Copa tem esta sombra */
  font-size: 16px; padding: 14px 28px;
}
```
**Divergência:** a sombra verde (`box-shadow`) do botão sticky existe só na Copa. BR2026/CDB2026
têm `.sticky-submit button { min-width:200px; padding:14px 28px; font-size:16px;
box-shadow:0 4px 24px rgba(0,0,0,.5) }` — cor da sombra diferente (verde-translúcido na Copa,
preto na BR2026/CDB2026) e BR2026/CDB2026 adicionam `min-width:200px` que a Copa não tem.

**Especificação recomendada:** unificar em `box-shadow: 0 4px 24px rgba(47,229,110,.35)` (a
cor verde reforça "ação primária positiva"; preto é neutro demais para o botão mais importante
da tela) e manter `min-width:200px` (evita o botão ficar pequeno demais em telas largas).

## Admin Toolbar

```css
.admin-toolbar { display: flex; gap: 6-8px; flex-wrap: wrap; margin-bottom: 8-14px; }
```
Estrutura CSS idêntica nos três. **Densidade de conteúdo muito diferente:** Copa = 12 botões
`small-btn` numa única `flex-wrap` (em telas estreitas isso quebra em ~4 linhas de botões antes
de chegar em qualquer conteúdo — ver "Admin" nas inconsistências); BR2026 = 2 botões; CDB2026 =
4 botões. Não é um bug de componente (o componente é o mesmo), é uma questão de organização de
informação — ver seção "Admin" abaixo.

## Hero

Estruturalmente diferente por app:
- **Copa:** `.hero` é um grid de 2 colunas (`1fr 300px`) com toggle de colapsar
  (`.hero-toggle`), conteúdo condicional (`#heroCard{display:none}` — atualmente **sempre
  escondido por decisão de produto**, ver comentário no CSS), cards de partida ao vivo dentro
  do hero.
- **BR2026:** hero simples (`.hero-inner{display:flex;flex-direction:column}`) + dois cards
  irmãos fora do hero (`#liveMatchCard`, `#nextGameCard`), sem toggle de colapsar.
- **CDB2026:** hero simples, sem nenhum card de "ao vivo" (não tem placar ao vivo — sem API).

**Isso é esperado e correto** — cada app tem uma necessidade de hero diferente pela natureza do
torneio (Copa tem partidas simultâneas + mata-mata longo; BR2026 tem um jogo por vez;
CDB2026 não tem dado ao vivo). Classificado como `INTENTIONALLY_DIFFERENT`, não como bug.

## Modal

**Nenhum dos três apps tem um componente de modal/dialog real.** Todas as confirmações usam
`window.confirm()`/`window.alert()` nativos do navegador (exceto os toasts não-bloqueantes da
Copa, que substituem `alert()` mas não `confirm()`). Não há `<dialog>`, overlay customizado, ou
qualquer modal estilizado em nenhum lugar da plataforma.

## Tooltip

Só existe via atributo `title="..."` nativo do HTML (ex.: barras de probabilidade da Copa,
`title="${team}: ${pct}%"`) — sem componente de tooltip customizado em nenhum app. Consistente
por ausência total nos três — não há inconsistência porque não há implementação nenhuma pra
divergir.

## Loading / Spinner

**Não existe nenhum spinner ou indicador de carregamento animado em nenhum dos três apps.**
Estados de carregamento são só texto estático: `"Carregando calendário..."` (BR2026,
`#gamesList`), nenhuma equivalente na Copa nem no CDB2026 (a seção Jogos da Copa/CDB2026 aparece
vazia até o primeiro render, sem nenhuma mensagem). Gap real, não inconsistência entre apps —
os três têm o mesmo nível (zero) de sofisticação aqui.

## Empty State

- Copa/BR2026/CDB2026: `<p class="muted">${t("noEntries")}</p>` — texto simples centralizado
  por herança do container pai, sem ícone, sem CTA. **Idêntico nos três** (mesma classe
  `.muted`, mesmo padrão de string).
- **Status:** consistente ✅, mas rudimentar nos três igualmente (sem ilustração/ícone/CTA de
  "criar a primeira entrada") — oportunidade de melhoria de plataforma, não uma divergência.

## Skeleton

**Não existe em nenhum app.** Nenhuma tela usa skeleton loading — o conteúdo aparece vazio (ou
com o texto "Carregando...", só no BR2026) até o primeiro `renderAll()`. Consistente por
ausência.

---

## Consistência entre componentes — tabela completa

| Componente | Onde aparece | Consistente? | Correção sugerida | Prioridade |
|---|---|---|---|---|
| Botão Primary/Secondary/Danger/Small | Todos os apps, toda ação | ✅ Sim (idêntico) | Nenhuma | — |
| Card | Todos os apps, todo container | ✅ Sim (idêntico) | Nenhuma | — |
| Header/Footer/Sticky nav | Todos os apps | ✅ Sim (idêntico) | Nenhuma | — |
| Empty state | Ranking/Participantes vazios, todos os apps | ✅ Sim (idêntico, rudimentar) | Adicionar CTA "criar primeira entrada" nos três, se quiser melhorar (não é bug) | Low |
| **`main` max-width (largura do conteúdo)** | Toda a página, desktop | ❌ Não — Copa 1140px vs BR2026/CDB2026 860px | Padronizar em um valor único (recomendo 900–960px: mais largo que 860 sem chegar no exagero de 1140 numa UI de formulário/lista, não de dashboard) | **High** |
| **Input/Select (fundo, radius, foco)** | Todo formulário, todos os apps | ✅ Resolvido v4.126 — Copa migrada para o padrão BR2026/CDB2026 | Nenhuma | — |
| **Label de formulário (case, cor, tipografia)** | Todo formulário, todos os apps | ✅ Resolvido v4.126 — Copa migrada para uppercase/muted | Nenhuma | — |
| **h1/h2/h3 fora de `.section-head`** | Títulos dentro de cards, admin, simulador | ✅ Resolvido v1.16/v2.2 — regra global portada para BR2026/CDB2026 | Nenhuma | — |
| **Badge/status indicator** | Jogos (ao vivo/finalizado), pagamento | ✅ Resolvido v4.127/v1.17/v2.3 — paleta/formato convergidos (nomes de classe mantidos por app) | Nenhuma | — |
| **Ranking — estrutura do card** | Seção Ranking, todos os apps | ✅ Resolvido v1.17/v2.3 — BR2026/CDB2026 adotaram `.rank-row`/`.picks-detail` da Copa | Nenhuma | — |
| Toast/Alert não-bloqueante | Feedback de ação (salvar, erro, sync) | ✅ Resolvido v1.17/v2.3 — `showToast()` portado para BR2026/CDB2026 | Nenhuma | — |
| Sombra do botão sticky | Botão "Salvar entrada" | ✅ Resolvido v4.126/v1.16/v2.2 — sombra verde + `min-width:200px` nos três | Nenhuma | — |
| Símbolo do time (não-Copa) | Jogos, palpites, ranking | ✅ Sim, desde v1.15/v2.1 (escudo real ESPN, mesmas classes) — Copa usa bandeira, intencionalmente diferente | Nenhuma pendente | — |
| Tabela (`.rules-table`) | Seção Regras, todos os apps | ✅ Resolvido v4.126 — padding `7px 10px` nos três | Nenhuma | — |
| Tokens de cor (`--gold`, `--red`) | CSS `:root`, todos os apps | ⚠️ Parcial v4.126 — tokens existem nos três, `--red` da Copa (`#ff6b6b`) difere do valor de BR2026/CDB2026 (`#f87171`), não unificado (mudaria cor em produção) | Decidir valor único numa mudança visual deliberada, fora do escopo de patch mínimo | Low |
| WhatsApp button | Header, todos os apps | ✅ Sim, desde v1.14/v1.15/v2.1 (byte-a-byte igual, mesmo grupo) | Nenhuma | — |
| Admin toolbar (componente CSS) | Seção Admin | ✅ Sim (CSS idêntico) — densidade de conteúdo diverge (feature gap, não bug de componente) | Ver `CONSISTENCY_MATRIX.md` item 6 | Medium (feature, não UI) |
| Modal/Dialog | Nenhum app tem | — (ausência consistente) | Nenhuma ação — não é uma lacuna crítica dado o uso de `confirm()` nativo | — |
| Loading/Skeleton | Nenhum app tem de verdade | — (ausência consistente, exceto 1 string solta no BR2026) | Se for investir, adicionar um spinner simples nos três ao mesmo tempo | Low |

---

## Inconsistências — lista final classificada

**Status:** de 14 inconsistências catalogadas, 8 foram resolvidas em duas rodadas — patches
mínimos CSS-only (v4.126 Copa / v1.16 BR2026 / v2.2 CDB2026 — itens 4, 5, 6, 8, 11, e
parcialmente 9) e, com autorização explícita do Eduardo, os 3 findings maiores que tocam JS
(v4.127 Copa / v1.17 BR2026 / v2.3 CDB2026 — itens 1, 2, 7). Zero `Critical` restante em
`CONSISTENCY_MATRIX.md`. Itens 3, 10, 12, 13 e 14 seguem em aberto — ver o racional de cada um
abaixo.

### Critical

1. ✅ **Resolvido (v4.127/v1.17/v2.3).** Badge/status indicator tinha 3 implementações visuais
   diferentes para o mesmo conceito (`.status-chip` pílula sólida com hex literal /
   `.game-status` texto puro sem fundo / `.paid-badge` pílula translúcida com `rgba()`). CSS
   convergido nos três apps (mesma paleta baseada em `var()`, `border-radius:999px`,
   `padding:4px 10px`, `font-weight:900`); nomes de classe mantidos por app (custo de renomear
   no JS > benefício). CDB2026 continua sem chip de status de jogo — gap de feature (sem API
   ao vivo), não de componente, ver `CONSISTENCY_MATRIX.md` item 67.
2. ✅ **Resolvido (v1.17/v2.3).** Estrutura do card de Ranking era totalmente diferente — grid
   denso de 1 linha (Copa) vs card empilhado com detalhe sempre visível (BR2026/CDB2026).
   BR2026/CDB2026 reescreveram `renderRanking()` para adotar o `.rank-row`/`.picks-detail` da
   Copa (detalhe expansível por clique, `_openRankDetails`) — ver `CONSISTENCY_MATRIX.md`
   item 68.

### High

3. ✅ **Resolvido** (rodada não datada entre as duas auditorias anteriores — esta nota estava
   desatualizada e contradizia a tabela de mapeamento abaixo, que já mostrava `1140px` nos três
   apps). Confirmado em 2026-07-14 lendo o CSS atual: `main { max-width: 1140px; }` idêntico nos
   três (`bolao/css/styles.css:163`, `bolao/br2026/css/styles.css:122`,
   `bolao/cdb2026/css/styles.css:123`).
4. ✅ **Resolvido (v4.126).** Input/select com fundo, `border-radius` e comportamento de foco
   diferentes entre Copa e os outros dois apps — Copa migrada para o padrão dos outros dois.
5. ✅ **Resolvido (v4.126).** Label de formulário com case, cor e tipografia diferentes —
   Copa migrada para UPPERCASE/`var(--muted)`.
6. ✅ **Resolvido (v1.16/v2.2).** `h1/h2/h3` sem normalização global em BR2026/CDB2026 —
   mesma regra da Copa portada para os outros dois.
7. ✅ **Resolvido (v1.17/v2.3).** Sistema de toast não-bloqueante existia só na Copa —
   `showToast()`/`.bolao-toast` portados para BR2026/CDB2026, substituindo `alert()` em
   confirmações/erros (validação de formulário continua `alert()`, igual à Copa) — ver
   `CONSISTENCY_MATRIX.md` item 69.

### Medium

8. ✅ **Resolvido (v4.126/v1.16/v2.2).** Sombra e `min-width` do botão sticky
   (`.sticky-submit button`) divergiam entre Copa e os outros dois apps — unificados em sombra
   verde `rgba(47,229,110,.35)` + `min-width:200px`.
9. ⚠️ **Parcialmente resolvido.** Tokens `--gold`/`--red` agora existem no `:root` da Copa
   (v4.126); `--red` ficou com o valor já usado em produção (`#ff6b6b`), diferente do
   `#f87171` de BR2026/CDB2026 — não unificado de propósito (ver `CONSISTENCY_MATRIX.md`
   item 62).
10. Admin toolbar com densidade de ação muito diferente (12 vs 2–4 botões) — não é bug de
    componente, mas é uma lacuna de feature já catalogada que também é uma divergência de UX
    percebida. Não tocado nesta rodada (é feature, não patch de UI).
11. ✅ **Resolvido (v4.126).** `.rules-table` com 1px de diferença de padding entre Copa e os
    outros dois apps.

### Low

12. Nenhuma tabela (exceto `.picks-detail` na Copa) tem um wrapper `overflow-x:auto`
    garantido — hoje não quebra porque o conteúdo é curto, mas não é uma garantia estrutural
    do componente `table`.
13. Empty state é idêntico mas rudimentar nos três (sem CTA/ilustração) — oportunidade de
    melhoria de plataforma, não uma divergência a corrigir.
14. Ausência de loading/skeleton state é consistente entre os três (ninguém tem), mas seria
    uma melhoria de percepção de performance se adicionada nos três ao mesmo tempo.

---

## Fora do escopo desta auditoria (não verificado)

- Contraste de cor medido por ferramenta (ex.: WebAIM) — as cores foram lidas do CSS, mas
  nenhum cálculo de contraste WCAG foi rodado.
- Comportamento real em Safari (motor WebKit) — só o código foi lido; comportamentos
  específicos de WebKit (como os já documentados em `LESSONS_LEARNED.md` para `change` em
  checkbox e cache agressivo) não foram re-testados nesta auditoria.
- Screenshots reais nos 8 breakpoints pedidos (320/375/390/414/768/900/1200/1600px) — os
  breakpoints que o CSS realmente define são `max-width:900px`, `max-width:500px`,
  `max-width:480px` e `min-width:901px` nos três apps (idênticos entre si) — qualquer
  largura pedida cai dentro de um desses buckets, mas o comportamento *visual* dentro de cada
  bucket não foi capturado.

---

## Copa como referência visual canônica — mapeamento por componente (2026-07-13)

Ver a regra permanente em `CLAUDE.md` ("Copa do Mundo 2026 é a referência visual canônica").
Tabela de mapeamento da rodada que padronizou header/nav, botões, formulários, cards, jogos/
times, ranking, pagamento e badges/status contra a Copa. Componentes já cobertos nas seções
acima (Botão, Input, Card, Badge, Header, Ranking) não são repetidos aqui.

| Componente | Referência (Copa) | BR2026 (antes → depois) | CDB2026 (antes → depois) | Risco | Intencional? |
|---|---|---|---|---|---|
| `main` max-width | `1140px` | `860px` → `1140px` | `860px` → `1140px` | Baixo — todos os grids internos usam `fr`/`auto-fill` | Não |
| Card de jogo | `.game-card` (background/border/radius) | Lista plana (`border-bottom`) → card completo | Já era card (`.confronto-card card`) | Baixo — só CSS, classe já usada no JS | Não |
| Grid time×placar | `.game-teams { 1fr auto 1fr }` | `.game-matchup` flex→grid | N/A — formato ida+volta é estrutura própria do torneio | Baixo (BR2026); N/A (CDB2026) | Não (BR2026); Sim (CDB2026, dados diferentes) |
| Card de pagamento | `.pay-card` com `.pay-icon` | Sem ícone → ícone (`payIcon()` portado) | Sem ícone → ícone (idem) | Baixo — assets reais copiados, não inventados | Não |
| `.pay-grid` colunas | `repeat(3,1fr)` | `auto-fill,minmax(200px,1fr)` → `repeat(3,1fr)` | idem | Nenhum — os 3 apps têm exatamente 3 métodos | Não |
| Texto do botão WhatsApp | "Suporte WhatsApp" | "WhatsApp" → "Suporte WhatsApp" | idem | Nenhum | Não |
| Spinner de `input[type=number]` | Suprimido | Ausente → suprimido | idem | Nenhum | Não |
| `.admin-toolbar` gap/margin | `8px`/`14px` | `6px`/`8px` → `8px`/`14px` | idem | Nenhum | Não |
| `.admin-row` (lista de entradas) | `.card.admin-entry` por linha | Lista densa `border-bottom` (mantido) | idem | — (não alterado) | **Sim, por ora** — densidade de dados admin, ver item 78 da matrix |
| Tabela de standings | N/A (Copa é mata-mata) | Só Pos/Time/Pts → +V/E/D/GP/GC/SG | N/A (sem API ao vivo) | Baixo — dado já vinha da ESPN | Sim — torneio sem equivalente na Copa |

## Validação visual pós-implementação — limitação e método real usado

**Não foi possível capturar screenshots reais nos viewports pedidos (375/390/768/1200/1440px)
nem comparar lado a lado em Safari/Chrome** — este sandbox não teve extensão de navegador
conectada em nenhum momento desta tarefa. A tabela abaixo reflete o que foi **verificado por
código** (valores de CSS computáveis, estrutura de grid/flex, presença/ausência de classes) —
não uma inspeção visual real. Marcado explicitamente onde isso importa.

| Componente | Copa | BR2026 | CDB2026 | Status final | Diferença intencional |
|---|---|---|---|---|---|
| Topbar/nav | referência | idêntico (CSS byte-a-byte) | idêntico | MATCHED | — |
| Botão Primary/Secondary/Danger/Small | referência | idêntico | idêntico | MATCHED | — |
| Input/Select/Label | referência | idêntico (desde v4.126) | idêntico | MATCHED | — |
| Card | referência | idêntico | idêntico | MATCHED | — |
| Badge/status | `.status-chip` | `.game-status`/`.paid-badge` — CSS convergido, nomes de classe diferentes | idem | MATCHED (visual); classe diferente | Sim — custo de renomear no JS > benefício |
| Ranking (`.rank-row`) | referência | idêntico desde v1.17 | idêntico desde v2.3 | MATCHED | — |
| Card de jogo | referência | idêntico desde v1.19 | usa `.card` compartilhada | MATCHED | — |
| Grid time×placar | referência | idêntico desde v1.19 | estrutura ida+volta própria | MATCHED (BR2026) | INTENTIONALLY_DIFFERENT (CDB2026) |
| Pagamento | referência | idêntico desde v1.19 | idêntico desde v2.5 | MATCHED | — |
| Admin toolbar (CSS do botão) | referência | idêntico | idêntico | MATCHED | — |
| Admin — lista de entradas | card por linha | lista densa `border-bottom` | idem | **NEEDS_FOLLOW_UP** | Não resolvido — ver item 78 |
| `main` max-width | `1140px` | `1140px` | `1140px` | MATCHED | — |
| **Altura real de botão renderizado em cada viewport** | — | — | — | **NEEDS_FOLLOW_UP** | Não verificado visualmente, só por CSS |
| **Comportamento em Safari real** | — | — | — | **NEEDS_FOLLOW_UP** | Não testado, sem browser disponível |

**Nenhum item foi declarado MATCHED sem checar altura/alinhamento/espaçamento/tipografia no
CSS real** — mas essa checagem foi estática (leitura de arquivo), não visual/renderizada. Uma
passada manual (`python3 -m http.server 8080`, abrir os três apps lado a lado em pelo menos
Chrome desktop + um device mobile real) é recomendada antes de considerar isto definitivamente
fechado.

## Movement (seta de posição — clube e ranking) (2026-07-13, BR2026 v1.23)

Componente novo, introduzido no BR2026 apenas — Copa e CDB2026 não o recebem nesta mudança (Copa
mantém `.status-chip`/`.rank-arrow` como estão; CDB2026 não tem tabela de liga, e o ranking de
participantes só ganharia esta seta em uma mudança futura separada, conforme o item registrado em
`CONSISTENCY_MATRIX.md`).

```css
.movement { display: inline-block; font-size: 12px; vertical-align: middle; }
.movement-up { color: var(--green); }
.movement-down { color: var(--red); }
.movement-same { color: var(--muted); }
.movement-unavailable { color: var(--muted); opacity: .6; }
.movement-n { font-size: .8em; font-weight: 700; margin-left: 1px; }
```

Dois pontos de uso, propositalmente com markup/classes de nível superior distintos (ver
`docs/bolao/BR2026_LIVE_STANDINGS.md` "Por que dois cálculos separados"):

- **Tabela do Brasileirão** (`standingsMovementHtml()`): coluna `.td-mov` dedicada, `▲`/`▼`/`•`/`–`
  com contagem de posições ao lado.
- **Ranking do bolão** (`rankMovementHtml()`): dentro de `.rank-row .rank-pos`, empilhado abaixo
  da medalha/número (`flex-direction: column`) para não empurrar o nome do participante.

Ambos usam `<span class="visually-hidden">` com o texto completo (nunca cor pura como único
portador de informação) e `title` como reforço, não como única fonte. Diferente do `.status-chip`
(pílula preenchida) ou `.paid-badge` (pílula translúcida com borda) documentados acima — este é
deliberadamente um glifo inline compacto (sem fundo/borda), porque aparece em uma coluna estreita
de tabela e dentro de uma célula de ranking de 48px; um badge de pílula não caberia nesses dois
contextos sem quebrar layout mobile.

Validado visualmente via Playwright nesta entrega (não apenas por leitura de CSS, ao contrário da
seção anterior): 320px, 390px e 1440px, com dados mockados de uma janela de partida ao vivo. Nos
três, Pos/Mov/Time/Pts permanecem visíveis sem scroll horizontal (colunas sticky), o nome do time
trunca com reticências em vez de empurrar as colunas seguintes, e a seta não quebra o alinhamento
da linha do ranking.

## Auditoria cosmética completa — screenshots reais nos três apps (2026-07-14)

Eduardo pediu uma varredura visual completa comparando os três apps contra a Copa. Diferente das
auditorias anteriores (leitura de CSS), esta rodada usou Playwright para capturar screenshots
reais (`fullPage`) de toda seção de nav × desktop (1440px) e mobile (390px) × os três apps —
44 screenshots — mais leitura de CSS para confirmar/entender cada divergência visual encontrada.

### Bug real encontrado e corrigido (não é preferência estética)

- **Ícone do Zelle quebrado em BR2026 e CDB2026.** Os dois apps referenciam
  `assets/zelle.svg` em `PAY_ICON_SVG` (`js/app.js`), mas o arquivo nunca existiu nas pastas
  `assets/` desses dois apps — só na Copa. Resultado: ícone de imagem quebrado no card de
  pagamento Zelle, nos dois apps, desde sempre (não é regressão desta sessão). Corrigido
  copiando `bolao/assets/zelle.svg` para `bolao/br2026/assets/zelle.svg` e
  `bolao/cdb2026/assets/zelle.svg` — mesmo arquivo, sem alteração de conteúdo.

### Divergências reais encontradas — decisão do Eduardo necessária

Diferente do bug acima, estas duas são escolhas de layout onde "copiar a Copa exatamente" tem um
trade-off real, não uma correção óbvia:

1. **Estrutura de cards da página Regras.** Copa agrupa em 2 cards (Pontuação+aviso /
   Regras principais+disclaimer). BR2026 usa **1 card único** com tudo dentro (pontuação,
   pontuação máxima, premiação, prazo, desempate, disclaimer). CDB2026 usa **7 cards separados**
   (pontuação, desempate, formato, 2 exemplos, premiação, prazo, transparência). Nenhum dos dois
   bate com o padrão de 2 cards da Copa. Diferença é parcialmente justificada — CDB2026 tem
   bem mais conteúdo (exemplos numéricos de ida/volta e partida única que a Copa não tem) — mas o
   *padrão* (quantos cards, o que agrupa com o quê) diverge nos três. Não alterado nesta rodada
   sem confirmação — reestruturar isso é uma decisão editorial de conteúdo, não só um reorder de
   markup.
2. **Nº de colunas do grid do nav em mobile (menor breakpoint).** Copa usa `repeat(4, 1fr)`.
   BR2026 e CDB2026 usam `repeat(3, 1fr)`. Isso não é uma cópia incompleta por acaso — BR2026 tem
   9 botões de nav e CDB2026 tem 8 (contra 6 visíveis na Copa), então 3 colunas trunca menos texto
   que forçar 4 colunas trocaria. Recomendação: **não** igualar cegamente à Copa aqui — o valor
   diferente parece uma adaptação deliberada e razoável ao maior número de itens, não drift. Sinalizado
   para confirmação do Eduardo antes de qualquer mudança.
   > **Atualização (2026-08, branch `fase2.2-correcao-final`, item 3):** a contagem real de
   > botões VISÍVEIS mudou desde esta nota (2026-07-14) — Copa/BR2026/CDB2026 tiveram colunas
   > desktop mortas removidas (Copa 8→6, BR2026 9→7, CDB2026 6 mantido), então a premissa "BR2026
   > tem 9/CDB2026 tem 8 contra 6 da Copa" não é mais verdadeira (hoje é 7/6/6). Com a contagem
   > real corrigida, os três apps convergiram para `repeat(3, minmax(0,1fr))` em mobile —
   > incluindo a Copa, que teve seu próprio `repeat(4,1fr)` alinhado (ver
   > `docs/bolao/CONSISTENCY_MATRIX.md`, nota "branch `fase2.2-correcao-final`"). A recomendação
   > "não igualar cegamente" continua correta como PRINCÍPIO (não copiar às cegas), mas a
   > conclusão prática mudou porque a premissa (contagem de botões) mudou, não porque o princípio
   > foi violado.

### Confirmado OK nesta rodada (sem ação necessária)

- `main { max-width: 1140px }` idêntico nos três — a nota antiga do item 3 (acima) estava
  desatualizada/contraditória com a tabela de mapeamento; corrigida.
- Ordem dos botões do header (WhatsApp → idioma → seletor de bolão) e do nav (Palpites → Ranking
  → Participantes → Pagamento → [Tabela, só BR2026] → Jogos → Probabilidades → Regras → Admin) —
  já corrigida em rodada anterior no mesmo dia, reconfirmada aqui.
- Empty states de Participantes/Ranking/Jogos/Probabilidades — mensagem consistente
  ("Nenhuma entrada ainda." / "Aguardando sorteio oficial") no padrão já esperado.
- Admin: painel do CDB2026 (com as novas seções "Sincronizar com a ESPN" e "Fases e confrontos")
  segue o mesmo padrão de card/h3 dos outros painéis admin — nenhuma inconsistência visual nova
  introduzida pelas features desta sessão.

### Fora do escopo desta rodada

- Comparação pixel-a-pixel do card de jogo (`.game-card`) — já auditado e convergido em rodada
  anterior (ver "Inconsistências" item 1 acima), não re-verificado exaustivamente aqui dado o
  volume de partidas na tela de Jogos da Copa (17000px de altura, não inspecionado linha a
  linha).
- Contraste de cor WCAG, comportamento real em Safari — mesmas limitações já registradas
  acima, ainda não cobertas.

## Auditoria "estilo big 4" — tokens CSS + card "Próximo jogo" (2026-07-14, Copa v4.131 / BR2026 v1.29 / CDB2026 v3.9)

Eduardo pediu explicitamente uma auditoria profunda comparando cores, fontes, tamanhos de fonte,
tamanho de campos de input e posicionamento nos três apps, "faça alterações" (não só reportar), e
apontou especificamente que o card de "próximo jogo" mostra campos diferentes (dia/hora/estádio)
em cada app. Diferente da rodada anterior (screenshots), esta comparou **os três arquivos CSS
inteiros, token a token**, e o código-fonte de cada widget "próximo jogo".

### Corrigido nesta rodada

| Item | Copa (referência) | BR2026/CDB2026 (antes) | Correção |
|---|---|---|---|
| `--red` (token) | `#ff6b6b` | `#f87171` | Alinhado ao valor da Copa nos dois apps — mesmo tom semântico ("ao vivo", "não pago") renderizava visivelmente diferente. |
| `.section-head` margin-bottom | `14px` (implícito, sem override de `h2`) | `16px` + `h2 { font-size: 22px }` próprio | Removido o override — título de seção (`<h2>`) renderizava maior nos dois apps que na Copa (22px vs 20px/1.25rem). |
| `input, select { appearance }` | `appearance: none` explícito | ausente | Adicionado — todo `<select>` sem regra própria (pagamento, palpite de time) mostrava a seta nativa do navegador em vez do visual limpo já usado em `.bolao-switcher select`. |
| Card "Próximo jogo" — campos | Time, **hora** (sem data), local, contador | BR2026: time, **data+hora**, local, sem contador. CDB2026: **não existia**. | Unificado: time, **data+hora**, local nos três. Copa ganhou a data que faltava (`formatDate(m.date)`); CDB2026 ganhou o card inteiro pela primeira vez (`#nextTieCard`, mesmas classes `.next-game-*` do BR2026, mesmo formato de data `fmtDate()`/`brtLongDate()`). |

O card do CDB2026 depende de `matches[leg].kickoff` — hoje só é preenchido pela sincronização com
a ESPN (estendida nesta rodada para gravar `kickoff`/`venue`/`city` da primeira perna de um
confronto novo, não só o placar de partida já finalizada). Não existe ainda um jeito do admin
cadastrar `kickoff` manualmente — o card fica escondido normalmente até isso acontecer (mesmo
comportamento de "sem próximo jogo" que a Copa/BR2026 já têm). Registrado como lacuna conhecida em
`PROJECT_MEMORY.md`, não como bug — o card não fica quebrado ou com dado errado, só continua
escondido.

### Verificado e confirmado igual (sem ação necessária)

- Todos os outros tokens de `:root` (bg/bg2/bg3/border/border2/green/green-dk/text/muted/gold/
  danger-*) — idênticos nos três arquivos.
- `body { font-family, font-size, line-height }`, `button { ... }`, `.card`, `.topbar`,
  `.brand`, `.whatsapp-btn`, `.bolao-switcher`, `.lang-links`, `.nav` (exceto contagem de colunas,
  proporcional ao número de abas de cada app) — byte-idênticos.
- `input, select { padding, border-radius, border, background, color }` — valores idênticos
  (só faltava `appearance`, corrigido acima).
- `--yellow` (só existe no BR2026) — `INTENTIONALLY_DIFFERENT`: usado só para o estado
  "pontuação provisória" da classificação ao vivo, conceito que não existe na Copa nem no
  CDB2026 (mata-mata sem "provisório").

### Não corrigido nesta rodada — precisa de confirmação visual antes de mexer

- `main { padding }`: Copa usa `20px 18px` (sem padding-bottom extra); BR2026/CDB2026 usam
  `16px 14px 80px` (80px de folga embaixo, provavelmente para o `.sticky-submit` não cobrir o
  último card ao rolar até o fim). Não fica claro se a Copa também precisaria dessa folga (tem
  o mesmo `.sticky-submit`) ou se BR2026/CDB2026 têm folga demais — precisa de inspeção visual
  real (rolar até o fim de cada formulário nos 3 apps) antes de decidir qual lado corrigir.
  Registrado aqui para não ficar esquecido, não implementado sem essa verificação.
  > **Atualização (2026-08-16, BR2026 v1.47/CDB2026 v3.35):** a folga de 80px de padding-bottom
  > foi removida (achado real, Eduardo: "muito espaço vazio no final da página") — ver
  > `docs/bolao/CONSISTENCY_MATRIX.md`, nota "80px de padding-bottom sobrando". `main` passou a
  > ser `16px 14px` (sem componente de bottom extra) nos dois apps.
  > **Atualização (2026-08, branch `fase2.2-correcao-final`, item 8):** o valor NUMÉRICO do
  > padding (não só a folga extra) foi então alinhado à Copa também, autorizado explicitamente
  > pelo Eduardo — BR2026/CDB2026 agora usam `20px 18px`, igual à Copa. `.form-grid` recebeu o
  > mesmo tratamento (era `repeat(auto-fill, minmax(220px,1fr))` gap `14px`, agora
  > `repeat(2, minmax(0,1fr))` gap `12px`, com colapso pra 1 coluna em
  > `@media (max-width:900px)` que faltava nesses dois apps). Verificado com screenshots reais
  > 320/768/1440px antes/depois: nenhum overflow novo, `.sticky-submit` (fluxo normal, não
  > fixed/sticky) nunca cobre nenhum campo. Achado extra: sem o colapso de breakpoint, o
  > formulário rendia 3 colunas espremidas a 768px — corrigido junto. Detalhe completo:
  > `bolao/br2026/CHANGELOG.md` v1.85, `bolao/cdb2026/CHANGELOG.md` v3.83,
  > `docs/bolao/CONSISTENCY_MATRIX.md` (nota "branch `fase2.2-correcao-final`"). **Esta
  > pendência está resolvida — não é mais um item em aberto.**

## Correção: esquema de cor dourado do CDB2026 — buraco real na metodologia da auditoria anterior (2026-07-14, CDB2026 v3.10)

Eduardo apontou, com razão: "Cdb tem cores diferentes você não viu isso? Impossível". A auditoria
"estilo big 4" registrada acima comparou os **valores** dos tokens `:root` entre os três CSS
(`--gold: #f59e0b` idêntico nos três, por exemplo) e concluiu "idêntico" — mas nunca verificou se
o **mesmo token era usado no mesmo elemento** nos três apps. Esse foi o buraco: CDB2026 usava
`var(--gold)` como cor primária (título do hero, cabeçalho de cada fase no formulário de palpites,
cabeçalhos de confronto em Jogos/Admin, gradiente do hero) exatamente onde a Copa e o BR2026 usam
`var(--green)` — visualmente óbvio ao abrir o app (o app inteiro parece "dourado" em vez de
"verde"), mas invisível numa comparação token-a-valor. **Lição para auditorias futuras**: comparar
valor de token não basta — é preciso também comparar, elemento por elemento, qual token cada app
usa nesse elemento.

Corrigido: `.hero-eyebrow`, `.pick-group-header.champion-header`, `.games-round-header`/
`.admin-round-header`, `.confronto-header` e o gradiente de fundo do `.hero` (`bolao/cdb2026/css/
styles.css`) passaram de `var(--gold)`/tons âmbar para `var(--green)`/tons verdes, idênticos ao
padrão já usado pelo BR2026 para os mesmos elementos. Mantido dourado só em `.pick-partial`
(estado semântico de "parcial", mesma ideia do amarelo `--yellow` do BR2026 — não é cor de marca).

Nenhuma justificativa de `TOURNAMENT_SPECIFIC` foi encontrada em nenhum documento para esse
esquema dourado — não havia decisão registrada de Eduardo aprovando isso, então foi tratado como
divergência não intencional, não como preferência estética a preservar.

## "Próximo jogo" — faltava o contador visual em si, não só o campo de data (2026-07-14, BR2026 v1.30 / CDB2026 v3.11)

Rodada anterior (v3.9) unificou os CAMPOS mostrados no card "Próximo jogo" (time/data/hora/local)
mas não verificou se o COMPONENTE de contador em si (a caixa de dígitos grandes que a Copa usa,
`.next-match-timer`) também estava presente nos outros dois apps — outro caso do mesmo buraco de
metodologia documentado acima (verificar campo/token não basta, é preciso verificar o componente
inteiro). Eduardo apontou: "próximo jogo br nao mostra countdown... igual copa que funciona bem".

Achado: BR2026 tinha só texto inline ("6d 01h 13m"), sem caixa de dígitos. CDB2026 tinha um texto
de contador ainda mais limitado (só para partidas em menos de 1h) e nem isso atualizava ao vivo —
`renderNextTieCard()` não tinha nenhum `setInterval` próprio, só re-renderizava quando
`renderAll()` rodava por outro motivo. Corrigido: `countdownTimerHtml()` (mesmo nome/mesma
implementação nos dois apps) gera a mesma caixa `.count-grid` + dias/horas/min/seg da Copa;
CDB2026 ganhou um `setInterval` de 1s dedicado (junto ao `renderCountdown()` do topo, que já
tinha). Ver `PROJECT_MEMORY.md` para a lição de metodologia.
