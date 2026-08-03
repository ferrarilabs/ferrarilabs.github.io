# Auditoria de Consistência Visual — Estilos Computados (PR120-final review items 3/4/7)

Gerado em 2026-08-03T17:40:19.090Z · commit `8a61443` · referência visual: **copa2026** (golden master, ver CLAUDE.md).

Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em `ALLOWLIST.json`, com fonte/owner/data) · **DIVERGENT** (diferença sem entrada no allowlist — bloqueia exit 0) · **N/A** (componente não existe no app).

## Resumo

| Status | Quantidade |
|---|---|
| EQUAL | 364 |
| EQUIVALENT | 0 |
| JUSTIFIED | 6 |
| DIVERGENT | 8 |
| N/A | 0 |

## Divergências não aprovadas (DIVERGENT) — bloqueiam exit 0

| Componente | Propriedade | copa2026 | br2026 | cdb2026 |
|---|---|---|---|---|
| Form grid (.form-grid) | height | `226.5px` | `147px` | `auto` |
| Form grid (.form-grid) | gridTemplateColumns | `527px 527px` | `527px 527px` | `repeat(2, minmax(0px, 1fr))` |
| Botão small (texto sintético) | height | `34px` | `46.5px` | `46.5px` |
| Botão destrutivo (texto sintético) | height | `34px` | `46.5px` | `46.5px` |
| Card de jogo | gap | `normal` | `4px` | `normal` |
| Card de jogo | height | `152px` | `84px` | `187px` |
| Badge de status de jogo (estado 'encerrado') | gap | `normal` | `4px` | `4px` |
| Badge de status de jogo (estado 'encerrado') | minHeight | `auto` | `auto` | `0px` |

## Divergências aprovadas (JUSTIFIED) — ver ALLOWLIST.json

| Componente | Propriedade | Justificativa |
|---|---|---|
| Topbar | height | `.topbar` CSS is byte-identical across all three apps (display:flex; align-items:center; gap:10px; padding:10px 18px; flex-wrap:wrap — verified by diffing the three stylesheets' .topbar rules directly). The remaining height difference (Copa/BR2026 108.5px vs CDB2026 118.5px at 1280x900) is caused by the nav/brand/switcher row wrapping onto a different number of lines depending on translated label lengths at that exact viewport width, not a token difference — the same class of issue PR120-final review item 3 names for toolbars generally ('altura de toolbar com quantidade diferente de botões'). [docRef: PR120-final review item 3 (verbatim task text, generalized from admin-toolbar to any nav/toolbar wrapping case); bolao/{copa2026,br2026,cdb2026}/css/styles.css .topbar rule (identical); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Nav de tabs (.nav) | gridTemplateColumns | Column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real visible button count by design (fixed in this branch, commit 9b11e3b — Copa 8→6, BR2026 9→7, CDB2026 6). Unequal track widths across apps given unequal button counts is the CORRECT outcome, not a regression. [docRef: bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78 (Fase 2.2-correção item 3); owner: Eduardo (prior session, reaffirmed PR120-final review); reviewDate: 2026-08-03] |
| main | height | Total rendered page length — a function of how much content each app currently has loaded (fixture size, number of phases/rounds/results), not a fixed design token. Comparing it as if it were a token would flag a DIVERGENT finding on every future content change in any app, forever, with no CSS fix possible. PR120-final review item 3 explicitly instructs: 'não compare altura total de main'. [docRef: PR120-final review item 3 (verbatim task text); docs/bolao/PLATFORM_GOVERNANCE.md; owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Card base (marcado) | height | The marked card (data-visual-audit="card-base", the scoring-rules card in Regras) wraps a <table class="rules-table"> whose row COUNT is tournament-specific scoring content (Copa 7 rows, BR2026 10 rows, CDB2026 6 rows) — this is TOURNAMENT_SPECIFIC data (see CLAUDE.md 'Diferenças específicas de torneio devem ser preservadas'), not a shared card-base token. Padding/margin/border-radius/background/font tokens on the card itself ARE compared normally (not excluded) — only the content-driven total height is excluded here. [docRef: CLAUDE.md platform governance ('Diferenças específicas de torneio devem ser preservadas — não generalizar entre apps'); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Admin toolbar (.admin-toolbar) | height | Copa's admin toolbar has 12 buttons (CSV/JSON/HTML export variants, API-Football, ESPN sync, result emails, force sync, clear data); BR2026/CDB2026 have 4 (export CSV/JSON, force sync, clear data) — a real, intentional difference in which admin tools exist per app, not a shared design token. `.admin-toolbar` CSS itself (display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px) is identical across all three. PR120-final review item 3 explicitly instructs: 'não compare... altura de toolbar com quantidade diferente de botões' — item 6 repeats this: functional differences must be NOT_APPLICABLE/JUSTIFIED, never compared as total height. [docRef: PR120-final review item 3 and item 6 (verbatim task text); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Card/linha de entrada no admin | height | Copa renders each admin entry as a full `.card.admin-entry` (multi-row, spaced layout); BR2026/CDB2026 use a dense single-line `.admin-row` list instead — a structural, admin-only-screen layout decision (long entry lists favor density), not a shared component with a divergent token. Same synthetic fixture content (2 fictional entries, same field names) is used for all three; only the wrapping structure differs, by design. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 78 (NEEDS_REVIEW, deliberately not converted); owner: Eduardo (prior session, reaffirmed PR120-final review); reviewDate: 2026-08-03] |

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
| height | `108.5px` | `108.5px` | `118.5px` | JUSTIFIED | `.topbar` CSS is byte-identical across all three apps (display:flex; align-items:center; gap:10px; padding:10px 18px; flex-wrap:wrap — verified by diffing the three stylesheets' .topbar rules directly). The remaining height difference (Copa/BR2026 108.5px vs CDB2026 118.5px at 1280x900) is caused by the nav/brand/switcher row wrapping onto a different number of lines depending on translated label lengths at that exact viewport width, not a token difference — the same class of issue PR120-final review item 3 names for toolbars generally ('altura de toolbar com quantidade diferente de botões'). [docRef: PR120-final review item 3 (verbatim task text, generalized from admin-toolbar to any nav/toolbar wrapping case); bolao/{copa2026,br2026,cdb2026}/css/styles.css .topbar rule (identical); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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
| gridTemplateColumns | `203.156px 203.172px 203.172px 203.156px 203.172px 203.172px` | `173.422px 173.422px 173.438px 173.422px 173.438px 173.422px 173.438px` | `203.156px 203.172px 203.172px 203.156px 203.172px 203.172px` | JUSTIFIED | Column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real visible button count by design (fixed in this branch, commit 9b11e3b — Copa 8→6, BR2026 9→7, CDB2026 6). Unequal track widths across apps given unequal button counts is the CORRECT outcome, not a regression. [docRef: bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78 (Fase 2.2-correção item 3); owner: Eduardo (prior session, reaffirmed PR120-final review); reviewDate: 2026-08-03] |

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
| padding | `20px 18px` | `20px 18px` | `20px 18px` | EQUAL | — |
| margin | `0px 70px` | `0px 70px` | `0px 70px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `7897.75px` | `1765px` | `4671.19px` | JUSTIFIED | Total rendered page length — a function of how much content each app currently has loaded (fixture size, number of phases/rounds/results), not a fixed design token. Comparing it as if it were a token would flag a DIVERGENT finding on every future content change in any app, forever, with no CSS fix possible. PR120-final review item 3 explicitly instructs: 'não compare altura total de main'. [docRef: PR120-final review item 3 (verbatim task text); docs/bolao/PLATFORM_GOVERNANCE.md; owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Card base (marcado) (`card-base`)

Seletores: copa2026=`[data-visual-audit="card-base"]`, br2026=`[data-visual-audit="card-base"]`, cdb2026=`[data-visual-audit="card-base"]`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `18px` | `18px` | `18px` | EQUAL | — |
| margin | `0px 0px 14px` | `0px 0px 14px` | `0px 0px 14px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `18px` | `18px` | `18px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `395.391px` | `752.828px` | `441.5px` | JUSTIFIED | The marked card (data-visual-audit="card-base", the scoring-rules card in Regras) wraps a <table class="rules-table"> whose row COUNT is tournament-specific scoring content (Copa 7 rows, BR2026 10 rows, CDB2026 6 rows) — this is TOURNAMENT_SPECIFIC data (see CLAUDE.md 'Diferenças específicas de torneio devem ser preservadas'), not a shared card-base token. Padding/margin/border-radius/background/font tokens on the card itself ARE compared normally (not excluded) — only the content-driven total height is excluded here. [docRef: CLAUDE.md platform governance ('Diferenças específicas de torneio devem ser preservadas — não generalizar entre apps'); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

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

### Heading de seção (Regras) (`rules-heading`)

Seletores: copa2026=`[data-visual-audit="rules-heading"]`, br2026=`[data-visual-audit="rules-heading"]`, cdb2026=`[data-visual-audit="rules-heading"]`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `16.8px` | `16.8px` | `16.8px` | EQUAL | — |
| fontWeight | `700` | `700` | `700` | EQUAL | — |
| lineHeight | `25.2px` | `25.2px` | `25.2px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `0px` | `0px` | `0px` | EQUAL | — |
| margin | `2.52px 0px 6.72px` | `2.52px 0px 6.72px` | `2.52px 0px 6.72px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `25.1875px` | `25.1875px` | `25.1875px` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Heading do formulário (Nova entrada) (`form-heading`)

Seletores: copa2026=`h2[data-i18n="entryTitle"]`, br2026=`h2[data-i18n="entryTitle"]`, cdb2026=`h2[data-i18n="entryTitle"]`

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
| height | `30px` | `30px` | `30px` | EQUAL | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Input de texto (`input-text`)

Seletores: copa2026=`#entryName`, br2026=`#entryName`, cdb2026=`#entryName`

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
| height | `44.5px` | `44.5px` | `44.5px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
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
| height | `44.5px` | `44.5px` | `44.5px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
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
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `12px` | `12px` | `12px` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `226.5px` | `147px` | `auto` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `527px 527px` | `527px 527px` | `repeat(2, minmax(0px, 1fr))` | DIVERGENT | — |

### Botão primário (texto sintético) (`button-primary`)

Seletores: copa2026=`[data-visual-audit="button-primary"]`, br2026=`[data-visual-audit="button-primary"]`, cdb2026=`[data-visual-audit="button-primary"]`

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
| height | `52px` | `52px` | `52px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão small (texto sintético) (`button-small`)

Seletores: copa2026=`[data-visual-audit="button-small"]`, br2026=`[data-visual-audit="button-small"]`, cdb2026=`[data-visual-audit="button-small"]`

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
| height | `34px` | `46.5px` | `46.5px` | DIVERGENT | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão destrutivo (texto sintético) (`button-danger`)

Seletores: copa2026=`[data-visual-audit="button-danger"]`, br2026=`[data-visual-audit="button-danger"]`, cdb2026=`[data-visual-audit="button-danger"]`

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
| height | `—` | `76.5px` | `76.5px` | EQUAL | — |
| minHeight | `—` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `—` | `48px 981.797px 18.2031px 0px` | `48px 981.797px 18.2031px 0px` | EQUAL | — |

### Card de jogo (`game-card`)

Seletores: copa2026=`.game-card`, br2026=`.game-card`, cdb2026=`.confronto-card`

> CDB2026 uses .confronto-card (ida+volta layout) instead of .game-card by design — CONSISTENCY_MATRIX.md item 72, INTENTIONALLY_DIFFERENT (tournament format, not a shared component).

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `14px` | `14px` | `14px` | EQUAL | — |
| margin | `0px 0px 10px` | `0px 0px 10px` | `0px 0px 10px` | EQUAL | — |
| gap | `normal` | `4px` | `normal` | DIVERGENT | — |
| borderRadius | `16px` | `16px` | `16px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `152px` | `84px` | `187px` | DIVERGENT | — |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Badge de status de jogo (estado 'encerrado') (`status-badge`)

Seletores: copa2026=`.status-chip.done`, br2026=`.game-status.post`, cdb2026=`.game-status.post`

> Class names differ by app (CONSISTENCY_MATRIX.md item 67: '.status-chip' vs '.game-status', kept per-app deliberately to avoid JS renaming risk) — CSS visual treatment is what's compared here, not the selector name.

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `11px` | `11px` | `11px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `16.5px` | `16.5px` | `16.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `4px 10px` | `4px 10px` | `4px 10px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `4px` | `4px` | DIVERGENT | — |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | EQUAL | — |
| color | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| height | `26.5px` | `26.5px` | `26.5px` | EQUAL | — |
| minHeight | `auto` | `auto` | `0px` | DIVERGENT | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

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
| height | `88.5px` | `46.5px` | `46.5px` | JUSTIFIED | Copa's admin toolbar has 12 buttons (CSV/JSON/HTML export variants, API-Football, ESPN sync, result emails, force sync, clear data); BR2026/CDB2026 have 4 (export CSV/JSON, force sync, clear data) — a real, intentional difference in which admin tools exist per app, not a shared design token. `.admin-toolbar` CSS itself (display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px) is identical across all three. PR120-final review item 3 explicitly instructs: 'não compare... altura de toolbar com quantidade diferente de botões' — item 6 repeats this: functional differences must be NOT_APPLICABLE/JUSTIFIED, never compared as total height. [docRef: PR120-final review item 3 and item 6 (verbatim task text); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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
| height | `—` | `89px` | `128px` | JUSTIFIED | Copa renders each admin entry as a full `.card.admin-entry` (multi-row, spaced layout); BR2026/CDB2026 use a dense single-line `.admin-row` list instead — a structural, admin-only-screen layout decision (long entry lists favor density), not a shared component with a divergent token. Same synthetic fixture content (2 fictional entries, same field names) is used for all three; only the wrapping structure differs, by design. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 78 (NEEDS_REVIEW, deliberately not converted); owner: Eduardo (prior session, reaffirmed PR120-final review); reviewDate: 2026-08-03] |
| minHeight | `—` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `—` | `none` | `none` | EQUAL | — |

### Célula de tabela de regras (.rules-table td) (`rules-table-cell`)

Seletores: copa2026=`.rules-table td`, br2026=`.rules-table td`, cdb2026=`.rules-table td`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `7px 10px` | `7px 10px` | `7px 10px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `0px` | `0px` | `0px` | EQUAL | — |
| backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `37px` | `37px` | `37px` | EQUAL | — |
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
