# Platform Design System — Bolão do Ferrari

Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:PLATFORM_DESIGN_SYSTEM` abaixo — o
bloco em si é substituído inteiramente a cada auditoria de design system. Ver também
`docs/bolao/PLATFORM_ARCHITECTURE.md`, `docs/bolao/CONSISTENCY_MATRIX.md`,
`docs/bolao/UI_REGRESSION_PROTOCOL.md`.

<!-- AUTO:PLATFORM_DESIGN_SYSTEM:START -->
A Copa do Mundo 2026 (`bolao/`) é a referência visual canônica da plataforma. Todo componente
equivalente em BR2026 e CDB2026 deve reproduzir seus tokens, dimensões, alinhamento,
espaçamento, tipografia, estados e comportamento responsivo, salvo diferença explicitamente
documentada como `TOURNAMENT_SPECIFIC`.

Todos os valores abaixo foram extraídos diretamente de `bolao/css/styles.css` (não inventados).
Onde BR2026/CDB2026 usam um valor diferente sem justificativa de torneio, ver
`docs/bolao/CONSISTENCY_MATRIX.md` para o status da divergência.

## Tokens

### Cores (variáveis CSS, `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#07141b` | fundo da página |
| `--bg2` | `#0d2028` | fundo de card |
| `--bg3` | `#10252d` | fundo de input/botão secundário/badge |
| `--border` | `#1f3b45` | borda padrão de card |
| `--border2` | `#29444d` | borda secundária (input, pill, botão secundário) |
| `--green` | `#2fe56e` | cor primária (positive/brand/focus ring) |
| `--green-dk` | `#03130b` | texto sobre fundo verde (botão primário) |
| `--text` | `#eef7f1` | texto principal |
| `--muted` | `#9cb2b9` | texto secundário/label |
| `--danger-bg` | `#3d1520` | fundo de badge/botão negativo |
| `--danger-tx` | `#ffdbe1` | texto sobre fundo negativo |
| `--danger-br` | `#8e2d42` | borda de botão negativo |
| `--gold` | `#f59e0b` | destaque/warning |
| `--red` | `#ff6b6b` | negativo/ao vivo (fora das variáveis nomeadas, usado direto) |

Cores semânticas sem variável própria (usadas diretamente): positivo = `--green`; negativo =
`#ff6b6b`/`--danger-*`; warning = `--gold`; info = não tem token dedicado (usa `--muted`);
disabled = `opacity: .45` (botão) / `opacity: .5` (input); focus ring = `#2fe56e` (mesmo valor de
`--green`, `outline: 2px solid #2fe56e; outline-offset: 3px`).

### Shadows / radii / spacing / tipografia

- **Shadow de card**: `box-shadow: 0 8px 32px rgba(0,0,0,.22)`.
- **Border radius — escala**: `4px` (skip-link), `6px` (barras/badges pequenas), `9px`
  (input/small-btn), `10px` (boxes secundários), `12px` (botão padrão/admin-row), `14px`
  (rank-row/match-card pequeno), `16px` (match-card/receipt), `18px` (`.card`, o container
  principal), `999px` (pill/badge/switcher — totalmente arredondado).
- **Spacing — escala observada**: `4px, 5px, 6px, 8px, 10px, 12px, 14px, 16px, 18px, 20px, 32px`.
  Sem uma escala formalizada em variável — os valores acima são os efetivamente usados.
- **Tipografia**: `font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif`.
  Corpo: `font-size: 15px; line-height: 1.5`. `h2 { font-size: 1.25rem }`, `h3 { font-size:
  1.05rem }`. Pesos usados: `400` (padrão), `600` (texto secundário destacado), `700` (label/nav
  ativo), `800` (nomes de time), `900` (botões/valores numéricos/marca).
- **Line-heights**: `1.5` (corpo), `1.2`–`1.35` (linhas compactas em cards/ranking mobile).
- **Z-index**: `.skip-link` = `9999`; `.topbar` (sticky) = `20`; `.sticky-submit` = `6`.
- **Transitions**: `opacity .15s` (hover de botão), `border-color .15s` (foco de input),
  `width .3s` (barra de progresso), `top .15s` (skip-link).
- **Breakpoints observados**: `max-width: 900px`, `max-width: 500px`, `max-width: 480px`,
  `min-width: 901px`.
- **Max-width do conteúdo**: `main { max-width: 1140px; margin: 0 auto; padding: 20px 18px; }`.
- **Safe-area**: não há `env(safe-area-inset-*)` em nenhum dos três apps — dívida técnica
  compartilhada, não introduzida por este patch, registrada aqui para rastreamento.

## Componentes

Estrutura documentada: nome canônico → seletor → estrutura → dimensões → estados →
comportamento responsivo → acessibilidade → diferenças permitidas.

### Botões

- **Seletor base**: `button` (sem classe) = primário. `.secondary`, `.danger`, `.small-btn`.
- **Primário**: `border:0; border-radius:12px; padding:11px 18px; background:var(--green);
  color:var(--green-dk); font-weight:900`.
- **Secundário**: `background:var(--bg3); color:var(--text); border:1px solid var(--border2)`.
- **Danger**: `background:var(--danger-bg); color:var(--danger-tx); border:1px solid
  var(--danger-br)`.
- **Small**: `.small-btn { padding:7px 11px; font-size:12px; border-radius:9px;
  white-space:nowrap }`.
- **Ghost/icon/loading/button-group/toolbar**: sem classes dedicadas na Copa — `.admin-toolbar {
  display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px }` é o padrão de agrupamento
  existente; um botão "loading" usa o próprio texto trocado (`btn.textContent = "Salvando..."`)
  em vez de uma classe/spinner dedicado nos três apps — dívida técnica compartilhada, não desta
  tarefa.
- **Estados**: `:hover { opacity:.88 }`; `:disabled { opacity:.45; cursor:not-allowed }`;
  `:focus-visible { outline:2px solid #2fe56e; outline-offset:3px }`.
- **Mobile**: `.sticky-submit button { min-width:200px; font-size:16px; padding:14px 28px }` —
  botão de ação principal fica maior e fixo no rodapé.
- **Alvo de toque**: `.nav button { min-height:44px }` (WCAG), achado de auditoria anterior já
  corrigido e propagado.

### Page container / Topbar / Brand / Nav

- `main { max-width:1140px; margin:0 auto; padding:20px 18px }`.
- `.topbar { position:sticky; top:0; z-index:20; background:rgba(7,20,27,.94);
  backdrop-filter:blur(12px); border-bottom:1px solid var(--border); display:flex;
  align-items:center; gap:10px; padding:10px 18px; flex-wrap:wrap }`.
- `.brand { display:flex; gap:8px; margin-right:auto; font-weight:900; font-size:16px }` +
  `.brand span { color:var(--muted); font-size:12px; font-weight:400 }` (subtítulo do torneio).
- **Tournament selector**: `.bolao-switcher select` — pill (`border-radius:999px`), `padding:7px
  14px`, `font-size:12px; font-weight:700`.
- **Language selector**: `.lang-links button` — mesmo padrão pill; `.active` usa `background:
  var(--green); color:var(--green-dk)`.
- **WhatsApp support**: `.whatsapp-btn` — pill verde WhatsApp (`#25D366`), ícone 18×18px.
- **Nav**: `.nav { display:grid; grid-template-columns:repeat(8, minmax(0,1fr)); gap:5px }`
  (Copa tem 8 abas — BR2026/CDB2026 têm contagens diferentes, `TOURNAMENT_SPECIFIC`, ajustar o
  número de colunas ao número real de abas do app, não copiar `8` literal). Botão: `padding:8px
  6px; font-size:13px; font-weight:700; min-height:44px`. `.active { background:var(--green);
  color:var(--green-dk) }`.

### Hero / Countdown

- `.hero { display:grid; grid-template-columns:1fr 300px; gap:16px }` — conteúdo à esquerda,
  card de contagem regressiva à direita, empilha em mobile (ver breakpoints).
- Contagem regressiva vive dentro de `.count-card` — estrutura de dígitos varia por app
  (`TOURNAMENT_SPECIFIC` no conteúdo, mas o container/card deve seguir `.card`).

### Section / Card / Card header/body/footer

- `.section-head` precede toda seção com `<h2>` + `<p class="muted">` opcional de subtítulo —
  padrão usado nas 3 apps (Ranking, Participantes, Pagamento, Jogos, Regras, etc.).
- `.card { background:var(--bg2); border:1px solid var(--border); border-radius:18px;
  padding:18px; margin-bottom:14px; box-shadow:0 8px 32px rgba(0,0,0,.22) }` — não há
  `.card-header`/`.card-body`/`.card-footer` como classes separadas na Copa; o cabeçalho é
  tipicamente um `<h2>`/`<h3>` direto dentro do `.card`.

### Input / Select / Label / Help text / Validation

- `label { display:flex; flex-direction:column; gap:5px }` + `label span { font-size:12px;
  font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em }`
  (marcador visual do label, não um asterisco de campo obrigatório — nenhum dos 3 apps usa `*`
  para required, dívida de acessibilidade compartilhada, não desta tarefa).
- `input, select { width:100%; padding:10px 12px; border-radius:9px; border:1px solid
  var(--border2); background:var(--bg3); color:var(--text); appearance:none }`.
- `:focus { border-color:var(--green) }`; `:disabled { opacity:.5; cursor:not-allowed }`.
- **Score input**: `.score-inputs input { text-align:center; font-size:20px; font-weight:900 }` —
  maior e centralizado, diferente de um input de texto comum.
- Validação de erro/sucesso: sem classe CSS dedicada na Copa — usa `alert()`/toast, não uma cor
  de borda de campo. `.error`/`.success` como classes de mensagem existem nos 3 apps, mas
  **não** como estado visual do próprio `<input>`.

### Game card / Team row / Score / Status

- `.match-card { background:var(--bg2); border:1px solid var(--border); border-radius:16px;
  padding:14px }`.
- `.teams { display:grid; grid-template-columns:1fr auto 1fr; gap:6px; align-items:center }` —
  simetria explícita entre mandante e visitante (mesma largura de coluna nos dois lados).
- `.team { font-weight:800; font-size:15px }`; `.team.right { justify-content:flex-end }`.
- `.vs { color:var(--muted); font-size:13px; text-align:center }`.
- `.match-badge { color:var(--green); font-weight:900; font-size:13px }` (nº da partida/fase).
- `.pill { font-size:11px; color:var(--muted); border:1px solid var(--border2);
  border-radius:999px; padding:4px 8px }` (data/hora/local).
- **Nunca** usar "Time A"/"Time B" como texto visível — nomes reais sempre, com fallback
  gracioso quando ainda não resolvido (ver `LESSONS_LEARNED.md` "Time A / Time B — flash de
  placeholder").

### Ranking row / Movement / Mobile card / Desktop table

- `.rank-row { display:grid; grid-template-columns:48px 1fr auto auto; gap:10px;
  background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:12px }` —
  linha densa de 1 nível, não uma tabela `<table>` nem um card empilhado.
- `.rank-pos { font-size:22px; text-align:center }`; `.points { font-size:26px;
  color:var(--green); font-weight:900; text-align:right }`.
- `.rank-arrow.up { color:var(--green) }`; `.rank-arrow.down { color:#ff6b6b }`.
- Mobile (`max-width:500px`): `.rank-pos { font-size:16px }`, nome em `font-size:13px;
  line-height:1.35`, `.points { font-size:17px; text-align:right }` — reduz escala, mantém
  estrutura de grid.
- Detalhe expansível (`.picks-detail`) usa `<table>` interna — ver seção "Ver palpites" no
  `CONSISTENCY_MATRIX.md` item 68 (já unificado nos 3 apps).

### Admin — toolbar / login / action group

- `.admin-toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px }`.
- `.admin-row` (não documentado com classe única na Copa — cada app define localmente; ver
  `.admin-row` em CDB2026 como o padrão mais recente/consistente entre os três: linha flex com
  label + valor + ação).

### Payment / Rules / Empty / Loading states

- Cartões de pagamento (`.pay-grid` + item) seguem `.card`-like styling, ícone + método +
  instrução + ação — mesma estrutura nos 3 apps.
- Tabela de regras: `<table>` simples dentro de `.card`, sem classe própria além do reset global.
- Empty/loading state: texto `<p class="muted">` — não há spinner/skeleton dedicado em nenhum
  app (dívida compartilhada).

### Receipt / Email shell

- `.receipt-code { font-family:ui-monospace,"Cascadia Code",monospace; color:#9fffc0;
  font-size:13px; letter-spacing:.03em }`.
- Email/PDF shell: HTML próprio (`receiptHtml()`), tema claro (diferente do tema escuro do app),
  já unificado entre os 3 apps nesta sessão (ver `CONSISTENCY_MATRIX.md` item 8/10).

### Footer

- `.site-footer-bar { margin-top:32px; padding:10px 16px; text-align:center; font-size:11px;
  color:var(--muted); border-top:1px solid var(--border2); opacity:.6 }` — versão + último sync.

## Componentes sem padrão canônico ainda (dívida técnica de design system, não desta tarefa)

Tooltip, modal genérico, spinner de loading dedicado, skeleton screen, alvo `*` de campo
obrigatório, botão "ghost" com classe própria. Nenhum dos três apps implementa esses componentes
hoje — não são regressões, são features de design system nunca construídas. Registrado aqui para
não serem confundidos com divergência entre apps.
<!-- AUTO:PLATFORM_DESIGN_SYSTEM:END -->
