# Auditoria de Consistência Visual — Estilos Computados (Fase 2.2-correção item 7)

Gerado em 2026-08-03T00:13:59.899Z · commit `bd8d06f` · referência visual: **copa2026** (golden master, ver CLAUDE.md).

Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em outro lugar do repo, motivo citado) · **DIVERGENT** (diferença sem justificativa registrada — precisa de revisão humana) · **N/A** (componente não existe no app).

## Resumo

| Status | Quantidade |
|---|---|
| EQUAL | 339 |
| EQUIVALENT | 0 |
| JUSTIFIED | 1 |
| DIVERGENT | 24 |
| N/A | 0 |

## Notas metodológicas (ler antes de interpretar `height`/`minHeight` como DIVERGENT)

- **`height` em elementos `height:auto`/orientados por conteúdo** (`main`, `.card`, `.topbar`, `.admin-toolbar`, admin-card-row) **varia com a QUANTIDADE de conteúdo renderizado**, não é um token de design fixo — `main`'s computed height (a página inteira) é literalmente proporcional a quanto conteúdo cada app tem carregado no momento da captura (fixtures diferentes, número de fases/jogos diferente), não uma medida de estilo comparável. Presente na tabela porque a tarefa pediu explicitamente para capturar `height`/`minHeight`, mas **não deve ser lido como um problema de design system** a menos que o elemento tenha uma altura fixa por CSS (ex.: `.small-btn`, `.danger`, `select`, `.rank-row` — esses SIM são comparáveis).
- **`.game-card` no BR2026 não foi capturado** (`null` na tabela) — `renderGamesSection()` do BR2026 só roda quando `_schedule.length > 0`, e esse script bloqueia/simula a API da ESPN com uma resposta vazia (mesma política de rede das outras ferramentas desta pasta — nunca produção real). Resultado: BR2026 não teve nenhum `.game-card` renderizado nesta auditoria, então a comparação com Copa/CDB2026 para esse componente ficou incompleta — não um DIVERGENT real, uma lacuna de fixture. Registrado aqui em vez de escondido.
- **`.card` compara o PRIMEIRO elemento `.card` no DOM de cada app**, que pode não ser o mesmo card semanticamente (ex.: o primeiro card de um app pode ser o hero/intro, o de outro pode ser um card de countdown com layout de grid próprio) — `gridTemplateColumns`/`backgroundColor`/`gap` divergentes aqui podem refletir estar comparando cards DIFERENTES, não um token de `.card` genuinamente inconsistente. Achado real (dois selectors com IDs verificados, `select`/`button-primary`, já foram corrigidos nesta mesma rodada depois de um problema idêntico ser encontrado — ver commit) mas não corrigido aqui por falta de um seletor comum óbvio entre os três apps para 'o card X especificamente'; recomendo revisão manual antes de tratar como DIVERGENT real.

## Divergências não justificadas (DIVERGENT) — precisam de revisão

| Componente | Propriedade | copa2026 | br2026 | cdb2026 |
|---|---|---|---|---|
| Topbar | height | `108.5px` | `108.5px` | `118.5px` |
| main | padding | `20px 18px` | `16px 14px` | `16px 14px` |
| main | height | `7897.75px` | `1522px` | `6088.5px` |
| Card (.card) | gap | `16px` | `normal` | `normal` |
| Card (.card) | backgroundColor | `rgb(13, 32, 40)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` |
| Card (.card) | height | `auto` | `120px` | `120px` |
| Card (.card) | gridTemplateColumns | `1fr 300px` | `none` | `none` |
| h3 | fontSize | `16.8px` | `16.8px` | `15px` |
| h3 | lineHeight | `25.2px` | `25.2px` | `22.5px` |
| h3 | margin | `2.52px 0px 6.72px` | `2.52px 0px 6.72px` | `0px 0px 6px` |
| Form grid (.form-grid) | margin | `0px` | `0px 0px 16px` | `0px 0px 16px` |
| Form grid (.form-grid) | gap | `12px` | `14px` | `14px` |
| Form grid (.form-grid) | gridTemplateColumns | `repeat(2, minmax(0px, 1fr))` | `repeat(auto-fill, minmax(220px, 1fr))` | `repeat(auto-fill, minmax(220px, 1fr))` |
| Botão small (.small-btn) | height | `46.5px` | `auto` | `auto` |
| Botão small (.small-btn) | minHeight | `auto` | `0px` | `0px` |
| Botão danger (.danger) | height | `34px` | `46.5px` | `46.5px` |
| Card de jogo | padding | `14px` | `N/A` | `18px` |
| Card de jogo | margin | `0px 0px 10px` | `N/A` | `0px 0px 14px` |
| Card de jogo | borderRadius | `16px` | `N/A` | `18px` |
| Badge de status de jogo | gap | `normal` | `N/A` | `4px` |
| Admin toolbar (.admin-toolbar) | height | `88.5px` | `46.5px` | `46.5px` |
| Card/linha de entrada no admin | height | `N/A` | `89px` | `128px` |
| Célula de tabela de regras (.rules-table td) | fontSize | `15px` | `13px` | `13px` |
| Célula de tabela de regras (.rules-table td) | lineHeight | `22.5px` | `19.5px` | `19.5px` |

## Detalhe por componente

### Topbar (`topbar`)

Seletores: copa2026=`.topbar`, br2026=`.topbar`, cdb2026=`.topbar`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `10px 18px` | `10px 18px` | `10px 18px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `8px 12px` | `8px 12px` | `8px 12px` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(7, 20, 27, 0.94)` | `rgba(7, 20, 27, 0.94)` | `rgba(7, 20, 27, 0.94)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `108.5px` | `108.5px` | `118.5px` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `627.562px 177.578px 260.859px 142px` | `627.562px 177.578px 260.859px 142px` | `627.562px 177.578px 260.859px 142px` | EQUAL | — |

### Brand / logo (`brand`)

Seletores: copa2026=`.brand`, br2026=`.brand`, cdb2026=`.brand`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `16px` | `16px` | `16px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `24px` | `24px` | `24px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `8px` | `8px` | `8px` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `24px` | `24px` | `24px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Seletor de competição (Alternar bolão) (`competition-selector`)

Seletores: copa2026=`.bolao-switcher`, br2026=`.bolao-switcher`, cdb2026=`.bolao-switcher`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `34px` | `34px` | `34px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão de idioma (`lang-button`)

Seletores: copa2026=`.lang-links button`, br2026=`.lang-links button`, cdb2026=`.lang-links button`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `12px` | `12px` | `12px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `18px` | `18px` | `18px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 12px` | `7px 12px` | `7px 12px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| color | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | EQUAL | — |
| height | `34px` | `34px` | `34px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão de idioma ativo (`lang-button-active`)

Seletores: copa2026=`.lang-links button.active`, br2026=`.lang-links button.active`, cdb2026=`.lang-links button.active`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `12px` | `12px` | `12px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `18px` | `18px` | `18px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 12px` | `7px 12px` | `7px 12px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| color | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | EQUAL | — |
| height | `34px` | `34px` | `34px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Nav de tabs (.nav) (`tabs-nav`)

Seletores: copa2026=`.nav`, br2026=`.nav`, cdb2026=`.nav`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `5px` | `5px` | `5px` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `44px` | `44px` | `44px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `203.156px 203.172px 203.156px 203.156px 203.156px 203.156px` | `173.422px 173.422px 173.438px 173.422px 173.438px 173.422px 173.438px` | `203.156px 203.172px 203.172px 203.156px 203.172px 203.172px` | JUSTIFIED | Fase 2.2-correção item 3 (this branch, bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78): column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real button count by design (that was the bug fixed in item 3), so unequal track widths across apps is the CORRECT outcome, not a regression. |

### Botão de tab (inativo) (`tab-button`)

Seletores: copa2026=`[data-section="ranking"]`, br2026=`[data-section="ranking"]`, cdb2026=`[data-section="ranking"]`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `13px` | `13px` | `13px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `19.5px` | `19.5px` | `19.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `8px 6px` | `8px 6px` | `8px 6px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `12px` | `12px` | `12px` | EQUAL | — |
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `44px` | `44px` | `44px` | EQUAL | — |
| minHeight | `44px` | `44px` | `44px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão de tab ativo (`tab-button-active`)

Seletores: copa2026=`.nav button.active`, br2026=`.nav button.active`, cdb2026=`.nav button.active`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `13px` | `13px` | `13px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `19.5px` | `19.5px` | `19.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `8px 6px` | `8px 6px` | `8px 6px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `12px` | `12px` | `12px` | EQUAL | — |
| backgroundColor | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| color | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | EQUAL | — |
| height | `44px` | `44px` | `44px` | EQUAL | — |
| minHeight | `44px` | `44px` | `44px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### main (`main`)

Seletores: copa2026=`main`, br2026=`main`, cdb2026=`main`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `20px 18px` | `16px 14px` | `16px 14px` | DIVERGENT | — |
| margin | `0px 70px` | `0px 70px` | `0px 70px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `7897.75px` | `1522px` | `6088.5px` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Card (.card) (`card`)

Seletores: copa2026=`.card`, br2026=`.card`, cdb2026=`.card`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `18px` | `18px` | `18px` | EQUAL | — |
| margin | `0px 0px 14px` | `0px 0px 14px` | `0px 0px 14px` | EQUAL | — |
| gap | `16px` | `normal` | `normal` | DIVERGENT | — |
| borderRadius | `18px` | `18px` | `18px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | DIVERGENT | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `120px` | `120px` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `1fr 300px` | `none` | `none` | DIVERGENT | — |

### h2 (`h2`)

Seletores: copa2026=`h2`, br2026=`h2`, cdb2026=`h2`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `20px` | `20px` | `20px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `30px` | `30px` | `30px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `3px 0px 8px` | `3px 0px 8px` | `3px 0px 8px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### h3 (`h3`)

Seletores: copa2026=`h3`, br2026=`h3`, cdb2026=`h3`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `16.8px` | `16.8px` | `15px` | DIVERGENT | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `25.2px` | `25.2px` | `22.5px` | DIVERGENT | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `2.52px 0px 6.72px` | `2.52px 0px 6.72px` | `0px 0px 6px` | DIVERGENT | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Input de texto (`input-text`)

Seletores: copa2026=`#entryName`, br2026=`input[type=text]`, cdb2026=`input[type=text]`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `10px 12px` | `10px 12px` | `10px 12px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `9px` | `9px` | `9px` | EQUAL | — |
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Select (`select`)

Seletores: copa2026=`#paymentMethod`, br2026=`#paymentMethod`, cdb2026=`#paymentMethod`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `10px 12px` | `10px 12px` | `10px 12px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `9px` | `9px` | `9px` | EQUAL | — |
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Form grid (.form-grid) (`form-grid`)

Seletores: copa2026=`.form-grid`, br2026=`.form-grid`, cdb2026=`.form-grid`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `0px` | `0px 0px 16px` | `0px 0px 16px` | DIVERGENT | — |
| gap | `12px` | `14px` | `14px` | DIVERGENT | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `repeat(2, minmax(0px, 1fr))` | `repeat(auto-fill, minmax(220px, 1fr))` | `repeat(auto-fill, minmax(220px, 1fr))` | DIVERGENT | — |

### Botão primário (`button-primary`)

Seletores: copa2026=`#saveEntry`, br2026=`#saveEntryBtn`, cdb2026=`#saveEntryBtn`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `16px` | `16px` | `16px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `24px` | `24px` | `24px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `14px 28px` | `14px 28px` | `14px 28px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `12px` | `12px` | `12px` | EQUAL | — |
| backgroundColor | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| color | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | `rgb(3, 19, 11)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão small (.small-btn) (`button-small`)

Seletores: copa2026=`.small-btn`, br2026=`.small-btn`, cdb2026=`.small-btn`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `12px` | `12px` | `12px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `18px` | `18px` | `18px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 11px` | `7px 11px` | `7px 11px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `9px` | `9px` | `9px` | EQUAL | — |
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `46.5px` | `auto` | `auto` | DIVERGENT | — |
| minHeight | `auto` | `0px` | `0px` | DIVERGENT | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão danger (.danger) (`button-danger`)

Seletores: copa2026=`.danger`, br2026=`.danger`, cdb2026=`.danger`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `12px` | `12px` | `12px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `18px` | `18px` | `18px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 11px` | `7px 11px` | `7px 11px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `9px` | `9px` | `9px` | EQUAL | — |
| backgroundColor | `rgb(61, 21, 32)` | `rgb(61, 21, 32)` | `rgb(61, 21, 32)` | EQUAL | — |
| color | `rgb(255, 219, 225)` | `rgb(255, 219, 225)` | `rgb(255, 219, 225)` | EQUAL | — |
| height | `34px` | `46.5px` | `46.5px` | DIVERGENT | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Linha de ranking (.rank-row) (`ranking-row`)

Seletores: copa2026=`.rank-row`, br2026=`.rank-row`, cdb2026=`.rank-row`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `—` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `—` | `15px` | `15px` | EQUAL | — |
| fontWeight | `—` | `400` | `400` | EQUAL | — |
| lineHeight | `—` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `—` | `normal` | `normal` | EQUAL | — |
| padding | `—` | `12px` | `12px` | EQUAL | — |
| margin | `—` | `0px 0px 8px` | `0px 0px 8px` | EQUAL | — |
| gap | `—` | `10px` | `10px` | EQUAL | — |
| borderRadius | `—` | `14px` | `14px` | EQUAL | — |
| backgroundColor | `—` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `—` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `—` | `auto` | `auto` | EQUAL | — |
| minHeight | `—` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `—` | `48px 1fr auto auto` | `48px 1fr auto auto` | EQUAL | — |

### Card de jogo (`game-card`)

Seletores: copa2026=`.game-card`, br2026=`.game-card`, cdb2026=`.confronto-card`

> CDB2026 uses .confronto-card (ida+volta layout) instead of .game-card by design — CONSISTENCY_MATRIX.md item 72, INTENTIONALLY_DIFFERENT (tournament format, not a shared component).

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `—` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `—` | `15px` | EQUAL | — |
| fontWeight | `400` | `—` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `—` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `—` | `normal` | EQUAL | — |
| padding | `14px` | `—` | `18px` | DIVERGENT | — |
| margin | `0px 0px 10px` | `—` | `0px 0px 14px` | DIVERGENT | — |
| gap | `normal` | `—` | `normal` | EQUAL | — |
| borderRadius | `16px` | `—` | `18px` | DIVERGENT | — |
| backgroundColor | `rgb(13, 32, 40)` | `—` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `—` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `—` | `auto` | EQUAL | — |
| minHeight | `0px` | `—` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `—` | `none` | EQUAL | — |

### Badge de status de jogo (`status-badge`)

Seletores: copa2026=`.status-chip`, br2026=`.game-status`, cdb2026=`.game-status`

> Class names differ by app (CONSISTENCY_MATRIX.md item 67: '.status-chip' vs '.game-status', kept per-app deliberately to avoid JS renaming risk) — CSS visual treatment is what's compared here, not the selector name.

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `—` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `11px` | `—` | `11px` | EQUAL | — |
| fontWeight | `900` | `—` | `900` | EQUAL | — |
| lineHeight | `16.5px` | `—` | `16.5px` | EQUAL | — |
| letterSpacing | `normal` | `—` | `normal` | EQUAL | — |
| padding | `4px 10px` | `—` | `4px 10px` | EQUAL | — |
| margin | `0px` | `—` | `0px` | EQUAL | — |
| gap | `normal` | `—` | `4px` | DIVERGENT | — |
| borderRadius | `999px` | `—` | `999px` | EQUAL | — |
| backgroundColor | `rgba(47, 229, 110, 0.15)` | `—` | `rgba(47, 229, 110, 0.15)` | EQUAL | — |
| color | `rgb(47, 229, 110)` | `—` | `rgb(47, 229, 110)` | EQUAL | — |
| height | `auto` | `—` | `auto` | EQUAL | — |
| minHeight | `0px` | `—` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `—` | `none` | EQUAL | — |

### Badge de pagamento (.paid-badge) (`paid-badge`)

Seletores: copa2026=`.paid-badge`, br2026=`.paid-badge`, cdb2026=`.paid-badge`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `—` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `—` | `11px` | `11px` | EQUAL | — |
| fontWeight | `—` | `900` | `900` | EQUAL | — |
| lineHeight | `—` | `16.5px` | `16.5px` | EQUAL | — |
| letterSpacing | `—` | `normal` | `normal` | EQUAL | — |
| padding | `—` | `4px 10px` | `4px 10px` | EQUAL | — |
| margin | `—` | `0px` | `0px` | EQUAL | — |
| gap | `—` | `normal` | `normal` | EQUAL | — |
| borderRadius | `—` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `—` | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | EQUAL | — |
| color | `—` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| height | `—` | `auto` | `auto` | EQUAL | — |
| minHeight | `—` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `—` | `none` | `none` | EQUAL | — |

### Admin toolbar (.admin-toolbar) (`admin-toolbar`)

Seletores: copa2026=`.admin-toolbar`, br2026=`.admin-toolbar`, cdb2026=`.admin-toolbar`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `0px 0px 14px` | `0px 0px 14px` | `0px 0px 14px` | EQUAL | — |
| gap | `8px` | `8px` | `8px` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `88.5px` | `46.5px` | `46.5px` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Card/linha de entrada no admin (`admin-card-row`)

Seletores: copa2026=`.admin-entry`, br2026=`.admin-row`, cdb2026=`.admin-row`

> Copa renders each admin entry as a full `.card.admin-entry`; BR2026/CDB2026 use a dense `.admin-row` list — CONSISTENCY_MATRIX.md item 78, NEEDS_REVIEW, deliberately not converted (admin-only screen, list can be long) — documented divergence, not an oversight.

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `—` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `—` | `14px` | `14px` | EQUAL | — |
| fontWeight | `—` | `400` | `400` | EQUAL | — |
| lineHeight | `—` | `21px` | `21px` | EQUAL | — |
| letterSpacing | `—` | `normal` | `normal` | EQUAL | — |
| padding | `—` | `8px 0px` | `8px 0px` | EQUAL | — |
| margin | `—` | `0px` | `0px` | EQUAL | — |
| gap | `—` | `8px` | `8px` | EQUAL | — |
| borderRadius | `—` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `—` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `—` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `—` | `89px` | `128px` | DIVERGENT | — |
| minHeight | `—` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `—` | `none` | `none` | EQUAL | — |

### Célula de tabela de regras (.rules-table td) (`rules-table-cell`)

Seletores: copa2026=`.rules-table td`, br2026=`.rules-table td`, cdb2026=`.rules-table td`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `13px` | `13px` | DIVERGENT | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `19.5px` | `19.5px` | DIVERGENT | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 10px` | `7px 10px` | `7px 10px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `auto` | `auto` | `auto` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão WhatsApp (.whatsapp-btn) (`whatsapp-button`)

Seletores: copa2026=`.whatsapp-btn`, br2026=`.whatsapp-btn`, cdb2026=`.whatsapp-btn`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `13px` | `13px` | `13px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `19.5px` | `19.5px` | `19.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `8px 13px` | `8px 13px` | `8px 13px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `6px` | `6px` | `6px` | EQUAL | — |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgb(37, 211, 102)` | `rgb(37, 211, 102)` | `rgb(37, 211, 102)` | EQUAL | — |
| color | `rgb(0, 0, 0)` | `rgb(0, 0, 0)` | `rgb(0, 0, 0)` | EQUAL | — |
| height | `35.5px` | `35.5px` | `35.5px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |
