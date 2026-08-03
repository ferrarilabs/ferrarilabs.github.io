# Auditoria de Consistência Visual — Estilos Computados (PR120-final review items 3/4/7)

Gerado em 2026-08-03T18:51:31.436Z · commit `f9961be` · referência visual: **copa2026** (golden master, ver CLAUDE.md).

Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em `ALLOWLIST.json`, com fonte/owner/data) · **DIVERGENT** (diferença sem entrada no allowlist — bloqueia exit 0) · **N/A** (componente não existe no app).

## Resumo

| Status | Quantidade |
|---|---|
| EQUAL | 393 |
| EQUIVALENT | 0 |
| JUSTIFIED | 13 |
| DIVERGENT | 0 |
| N/A | 14 |

## Divergências não aprovadas (DIVERGENT) — bloqueiam exit 0

Nenhuma. Todas as diferenças encontradas são EQUAL, EQUIVALENT ou JUSTIFIED (ver `ALLOWLIST.json`).

## Divergências aprovadas (JUSTIFIED) — ver ALLOWLIST.json

| Componente | Propriedade | Justificativa |
|---|---|---|
| Topbar | height | `.topbar` CSS is byte-identical across all three apps (display:flex; align-items:center; gap:10px; padding:10px 18px; flex-wrap:wrap — verified by diffing the three stylesheets' .topbar rules directly). The remaining height difference (Copa/BR2026 108.5px vs CDB2026 118.5px at 1280x900) is caused by the nav/brand/switcher row wrapping onto a different number of lines depending on translated label lengths at that exact viewport width, not a token difference — the same class of issue PR120-final review item 3 names for toolbars generally ('altura de toolbar com quantidade diferente de botões'). [docRef: PR120-final review item 3 (verbatim task text, generalized from admin-toolbar to any nav/toolbar wrapping case); bolao/{copa2026,br2026,cdb2026}/css/styles.css .topbar rule (identical); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Nav de tabs (.nav) | gridTemplateColumns | Column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real visible button count by design (fixed in this branch, commit 9b11e3b — Copa 8→6, BR2026 9→7, CDB2026 6). Unequal track widths across apps given unequal button counts is the CORRECT outcome, not a regression. [docRef: bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78 (Fase 2.2-correção item 3); owner: Eduardo (prior session, reaffirmed PR120-final review); reviewDate: 2026-08-03] |
| main | height | Total rendered page length — a function of how much content each app currently has loaded (fixture size, number of phases/rounds/results), not a fixed design token. Comparing it as if it were a token would flag a DIVERGENT finding on every future content change in any app, forever, with no CSS fix possible. PR120-final review item 3 explicitly instructs: 'não compare altura total de main'. [docRef: PR120-final review item 3 (verbatim task text); docs/bolao/PLATFORM_GOVERNANCE.md; owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Card base (marcado) | height | The marked card (data-visual-audit="card-base", the scoring-rules card in Regras) wraps a <table class="rules-table"> whose row COUNT is tournament-specific scoring content (Copa 7 rows, BR2026 10 rows, CDB2026 6 rows) — this is TOURNAMENT_SPECIFIC data (see CLAUDE.md 'Diferenças específicas de torneio devem ser preservadas'), not a shared card-base token. Padding/margin/border-radius/background/font tokens on the card itself ARE compared normally (not excluded) — only the content-driven total height is excluded here. [docRef: CLAUDE.md platform governance ('Diferenças específicas de torneio devem ser preservadas — não generalizar entre apps'); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Form grid (.form-grid) | height | `.form-grid` CSS itself is now byte-identical in all three apps (display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px — verified by diffing the three stylesheets directly; gridTemplateColumns resolves to the same `527px 527px` in all three post the item-7 selector fix above). The remaining height gap (Copa 226.5px vs BR2026/CDB2026 147px) is a field-COUNT difference, not a token: Copa's entry form has 5 fields (entryName, payerName, participantEmail, paymentMethod, and a static disabled 'Valor' field showing the fixed US$5 entry price) = 3 grid rows; BR2026/CDB2026 have 4 fields (no 'Valor' field — their entry price is shown elsewhere, not in the form itself) = 2 grid rows. Verified by reading each app's index.html entry-form markup directly. [docRef: bolao/copa2026/index.html vs bolao/br2026/index.html vs bolao/cdb2026/index.html (entry form field lists, verbatim); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Botão small (texto sintético) | height | `.small-btn`/`button` base CSS is byte-identical in all three apps (padding:7px 11px; font-size:12px; border-radius:9px for .small-btn; padding:11px 18px for the plain 'Sair'/logout button — verified by diffing the three stylesheets directly). `.admin-toolbar` uses `display:flex; flex-wrap:wrap` with the default `align-items:stretch`, so every button on the SAME wrapped row stretches to match the tallest sibling in that row. Copa's toolbar has 13 buttons (see the already-approved admin-toolbar entry above) that wrap onto 2 rows at 1280px — the measured forceSync button lands on the SECOND row, which has no full-size sibling, so it renders at its own natural 34px. BR2026/CDB2026's toolbar has only 5 buttons, all fitting on ONE row alongside the full-size 'Sair' button, so it stretches to match it (46.5px). Verified empirically (Playwright probe reading each button's boundingClientRect `top`/`height`): Copa's forceSync is at a different `top` than its own 'Sair' button (different row); BR2026/CDB2026's forceSync shares the exact same `top` as their 'Sair' button (same row, stretched). This is the same admin-tool-count difference already documented for `admin-toolbar:height` above, cascading down to its individual buttons — item 6 explicitly names this failure mode: 'diferenças de funcionalidade devem ser NOT_APPLICABLE ou JUSTIFIED, não comparadas como altura total'. [docRef: PR120-final review item 6 (verbatim task text); ALLOWLIST.json admin-toolbar entry above (same root cause); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Botão destrutivo (texto sintético) | height | `.danger`/`.small-btn`/`button` base CSS is byte-identical in all three apps (padding:7px 11px; font-size:12px; border-radius:9px for .small-btn; padding:11px 18px for the plain 'Sair'/logout button — verified by diffing the three stylesheets directly). Same root cause as `button-small:height` above: `.admin-toolbar`'s default `align-items:stretch` stretches every button on a wrapped flex row to match its tallest sibling. Copa's 13-button toolbar wraps the measured clearData button onto a row with no full-size sibling (34px, natural height); BR2026/CDB2026's 5-button toolbar puts clearData on the SAME row as the full-size 'Sair' button (46.5px, stretched). Verified empirically via Playwright probe (boundingClientRect `top`/`height` per button, same technique as button-small). [docRef: PR120-final review item 6 (verbatim task text); ALLOWLIST.json admin-toolbar/button-small entries above (same root cause); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Card de jogo | gap | BR2026's `.game-card` is its own internal `display:flex; flex-direction:column; gap:4px` layout, spacing 2 real stacked children (`.game-matchup`, `.game-meta`) — already flagged in `bolao/br2026/css/styles.css`'s own comment as 'BR2026's own internal flex layout, Copa's .game-card isn't a flex container at all — structural difference, not in [item 4]'s authorized scope'. Copa's `.game-card` (block layout, 3 children: `.game-top`/`.game-meta`/`.game-teams`) and CDB2026's `.confronto-card` (block layout, 2 children: `.confronto-header`/`.confronto-legs`, a deliberately different ida+volta component per CONSISTENCY_MATRIX item 72) are not flex containers, so `gap` computes to `normal` for both — matching their own child-spacing approach (margins, not flex gap). Verified via Playwright probe reading each card's `display`/`gap`/child list directly. Aligning this would mean restructuring BR2026's internal game-card layout, out of this task's authorized scope (item 4 covered padding/border-radius/margin-bottom only, explicitly not this). [docRef: bolao/br2026/css/styles.css .game-card comment (verbatim); docs/bolao/CONSISTENCY_MATRIX.md item 72; owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Card de jogo | height | Padding/border-radius/margin-bottom are already token-aligned across all three (item 4, prior commit). The remaining height gap is structure/content-driven, not a token: Copa's `.game-card` has 3 stacked children (`.game-top`/`.game-meta`/`.game-teams`); BR2026's has 2 (`.game-matchup`/`.game-meta`) with its own internal 4px gap (see the `game-card:gap` entry above); CDB2026's `.confronto-card` is a deliberately different ida+volta component (`.confronto-header`/`.confronto-legs`, 2 legs' worth of content) per CONSISTENCY_MATRIX item 72, INTENTIONALLY_DIFFERENT — not the same structural component as Copa/BR2026's `.game-card` at all. Verified via Playwright probe reading each card's actual child element list. Same class of exclusion already applied to `main:height`/`card-base:height` above (content length, not a fixed design token, with no CSS fix possible without restructuring a tournament-specific component). [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT); ALLOWLIST.json main/card-base entries above (same exclusion class); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Badge de status de jogo (estado 'encerrado') | gap | `gap` only has a visible effect with 2+ flex children to space apart. Confirmed by reading each app's renderer (bolao/{app}/js/app.js, the template literals that build the 'encerrado'/'post'/'done' badge): all three produce a single `<span>` with ONLY a text node inside (no separate icon element) — verified live via Playwright probe (`childElementCount: 0`, `childNodes: 1` in all three apps' captured badge). Copa's `.status-chip` doesn't set `display`/`gap` at all (plain inline text pill); BR2026/CDB2026's `.game-status` sets `display:inline-flex; align-items:center; gap:4px` (kept for potential future icon use, per the original BR2026 v1.17/CDB2026 v2.3 port — CONSISTENCY_MATRIX item 67). With no second child to space, `gap:4px` is currently inert — the computed difference has zero rendered visual effect. All other properties of this exact badge state (fontSize, fontWeight, padding, borderRadius, backgroundColor — color separately allowlisted above) are already EQUAL across all three apps per this same audit run. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 67; bolao/{br2026,cdb2026}/js/app.js badge template (verbatim, single text node); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| Badge de status de jogo (estado 'encerrado') | minHeight | getComputedStyle artifact of each app's own (already-intentionally-different, CONSISTENCY_MATRIX item 72) DOM structure around the badge, not a token: `min-height:auto` resolves to the unresolved keyword 'auto' when the element is itself a flex ITEM of its immediate parent, but resolves to a concrete used value ('0px', since no explicit minimum is set) when it isn't. BR2026 renders the badge as a direct child of `.game-meta` (display:flex) — a flex-item context, reported as 'auto'. CDB2026 renders the badge inside `.leg-info` (display:block, part of its deliberately different ida+volta leg layout) — a non-flex-item context, reported as '0px'. Copa's badge (inside its own non-flex `.game-top`) also reports 'auto' by the same mechanism, coincidentally matching BR2026. Verified via Playwright probe reading each badge's parent chain/display directly. Has zero effect on the badge's actual rendered size — padding/font-size/border-radius (all confirmed EQUAL) fully determine it; min-height never becomes the controlling dimension either way. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT DOM structure, root cause here too); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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

Seletores: copa2026=`[data-visual-audit="form-grid"]`, br2026=`[data-visual-audit="form-grid"]`, cdb2026=`[data-visual-audit="form-grid"]`

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
| height | `226.5px` | `147px` | `147px` | JUSTIFIED | `.form-grid` CSS itself is now byte-identical in all three apps (display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px — verified by diffing the three stylesheets directly; gridTemplateColumns resolves to the same `527px 527px` in all three post the item-7 selector fix above). The remaining height gap (Copa 226.5px vs BR2026/CDB2026 147px) is a field-COUNT difference, not a token: Copa's entry form has 5 fields (entryName, payerName, participantEmail, paymentMethod, and a static disabled 'Valor' field showing the fixed US$5 entry price) = 3 grid rows; BR2026/CDB2026 have 4 fields (no 'Valor' field — their entry price is shown elsewhere, not in the form itself) = 2 grid rows. Verified by reading each app's index.html entry-form markup directly. [docRef: bolao/copa2026/index.html vs bolao/br2026/index.html vs bolao/cdb2026/index.html (entry form field lists, verbatim); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `527px 527px` | `527px 527px` | `527px 527px` | EQUAL | — |

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
| height | `34px` | `46.5px` | `46.5px` | JUSTIFIED | `.small-btn`/`button` base CSS is byte-identical in all three apps (padding:7px 11px; font-size:12px; border-radius:9px for .small-btn; padding:11px 18px for the plain 'Sair'/logout button — verified by diffing the three stylesheets directly). `.admin-toolbar` uses `display:flex; flex-wrap:wrap` with the default `align-items:stretch`, so every button on the SAME wrapped row stretches to match the tallest sibling in that row. Copa's toolbar has 13 buttons (see the already-approved admin-toolbar entry above) that wrap onto 2 rows at 1280px — the measured forceSync button lands on the SECOND row, which has no full-size sibling, so it renders at its own natural 34px. BR2026/CDB2026's toolbar has only 5 buttons, all fitting on ONE row alongside the full-size 'Sair' button, so it stretches to match it (46.5px). Verified empirically (Playwright probe reading each button's boundingClientRect `top`/`height`): Copa's forceSync is at a different `top` than its own 'Sair' button (different row); BR2026/CDB2026's forceSync shares the exact same `top` as their 'Sair' button (same row, stretched). This is the same admin-tool-count difference already documented for `admin-toolbar:height` above, cascading down to its individual buttons — item 6 explicitly names this failure mode: 'diferenças de funcionalidade devem ser NOT_APPLICABLE ou JUSTIFIED, não comparadas como altura total'. [docRef: PR120-final review item 6 (verbatim task text); ALLOWLIST.json admin-toolbar entry above (same root cause); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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
| height | `34px` | `46.5px` | `46.5px` | JUSTIFIED | `.danger`/`.small-btn`/`button` base CSS is byte-identical in all three apps (padding:7px 11px; font-size:12px; border-radius:9px for .small-btn; padding:11px 18px for the plain 'Sair'/logout button — verified by diffing the three stylesheets directly). Same root cause as `button-small:height` above: `.admin-toolbar`'s default `align-items:stretch` stretches every button on a wrapped flex row to match its tallest sibling. Copa's 13-button toolbar wraps the measured clearData button onto a row with no full-size sibling (34px, natural height); BR2026/CDB2026's 5-button toolbar puts clearData on the SAME row as the full-size 'Sair' button (46.5px, stretched). Verified empirically via Playwright probe (boundingClientRect `top`/`height` per button, same technique as button-small). [docRef: PR120-final review item 6 (verbatim task text); ALLOWLIST.json admin-toolbar/button-small entries above (same root cause); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Botão secundário (Sair) (`button-secondary`)

Seletores: copa2026=`#adminLogoutBtn`, br2026=`#adminLogoutBtn`, cdb2026=`#adminLogoutBtn`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `900` | `900` | `900` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `11px 18px` | `11px 18px` | `11px 18px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `12px` | `12px` | `12px` | EQUAL | — |
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `46.5px` | `46.5px` | `46.5px` | EQUAL | — |
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
| gap | `normal` | `4px` | `normal` | JUSTIFIED | BR2026's `.game-card` is its own internal `display:flex; flex-direction:column; gap:4px` layout, spacing 2 real stacked children (`.game-matchup`, `.game-meta`) — already flagged in `bolao/br2026/css/styles.css`'s own comment as 'BR2026's own internal flex layout, Copa's .game-card isn't a flex container at all — structural difference, not in [item 4]'s authorized scope'. Copa's `.game-card` (block layout, 3 children: `.game-top`/`.game-meta`/`.game-teams`) and CDB2026's `.confronto-card` (block layout, 2 children: `.confronto-header`/`.confronto-legs`, a deliberately different ida+volta component per CONSISTENCY_MATRIX item 72) are not flex containers, so `gap` computes to `normal` for both — matching their own child-spacing approach (margins, not flex gap). Verified via Playwright probe reading each card's `display`/`gap`/child list directly. Aligning this would mean restructuring BR2026's internal game-card layout, out of this task's authorized scope (item 4 covered padding/border-radius/margin-bottom only, explicitly not this). [docRef: bolao/br2026/css/styles.css .game-card comment (verbatim); docs/bolao/CONSISTENCY_MATRIX.md item 72; owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| borderRadius | `16px` | `16px` | `16px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `152px` | `84px` | `187px` | JUSTIFIED | Padding/border-radius/margin-bottom are already token-aligned across all three (item 4, prior commit). The remaining height gap is structure/content-driven, not a token: Copa's `.game-card` has 3 stacked children (`.game-top`/`.game-meta`/`.game-teams`); BR2026's has 2 (`.game-matchup`/`.game-meta`) with its own internal 4px gap (see the `game-card:gap` entry above); CDB2026's `.confronto-card` is a deliberately different ida+volta component (`.confronto-header`/`.confronto-legs`, 2 legs' worth of content) per CONSISTENCY_MATRIX item 72, INTENTIONALLY_DIFFERENT — not the same structural component as Copa/BR2026's `.game-card` at all. Verified via Playwright probe reading each card's actual child element list. Same class of exclusion already applied to `main:height`/`card-base:height` above (content length, not a fixed design token, with no CSS fix possible without restructuring a tournament-specific component). [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT); ALLOWLIST.json main/card-base entries above (same exclusion class); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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
| gap | `normal` | `4px` | `4px` | JUSTIFIED | `gap` only has a visible effect with 2+ flex children to space apart. Confirmed by reading each app's renderer (bolao/{app}/js/app.js, the template literals that build the 'encerrado'/'post'/'done' badge): all three produce a single `<span>` with ONLY a text node inside (no separate icon element) — verified live via Playwright probe (`childElementCount: 0`, `childNodes: 1` in all three apps' captured badge). Copa's `.status-chip` doesn't set `display`/`gap` at all (plain inline text pill); BR2026/CDB2026's `.game-status` sets `display:inline-flex; align-items:center; gap:4px` (kept for potential future icon use, per the original BR2026 v1.17/CDB2026 v2.3 port — CONSISTENCY_MATRIX item 67). With no second child to space, `gap:4px` is currently inert — the computed difference has zero rendered visual effect. All other properties of this exact badge state (fontSize, fontWeight, padding, borderRadius, backgroundColor — color separately allowlisted above) are already EQUAL across all three apps per this same audit run. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 67; bolao/{br2026,cdb2026}/js/app.js badge template (verbatim, single text node); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | EQUAL | — |
| color | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| height | `26.5px` | `26.5px` | `26.5px` | EQUAL | — |
| minHeight | `auto` | `auto` | `0px` | JUSTIFIED | getComputedStyle artifact of each app's own (already-intentionally-different, CONSISTENCY_MATRIX item 72) DOM structure around the badge, not a token: `min-height:auto` resolves to the unresolved keyword 'auto' when the element is itself a flex ITEM of its immediate parent, but resolves to a concrete used value ('0px', since no explicit minimum is set) when it isn't. BR2026 renders the badge as a direct child of `.game-meta` (display:flex) — a flex-item context, reported as 'auto'. CDB2026 renders the badge inside `.leg-info` (display:block, part of its deliberately different ida+volta leg layout) — a non-flex-item context, reported as '0px'. Copa's badge (inside its own non-flex `.game-top`) also reports 'auto' by the same mechanism, coincidentally matching BR2026. Verified via Playwright probe reading each badge's parent chain/display directly. Has zero effect on the badge's actual rendered size — padding/font-size/border-radius (all confirmed EQUAL) fully determine it; min-height never becomes the controlling dimension either way. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT DOM structure, root cause here too); owner: Eduardo (task authorization, PR120-final review); reviewDate: 2026-08-03] |
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

### Toast (notificação) (`toast`)

Seletores: copa2026=`.bolao-toast.info`, br2026=`.bolao-toast.info`, cdb2026=`.bolao-toast.info`

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `13px` | `13px` | `13px` | EQUAL | — |
| fontWeight | `600` | `600` | `600` | EQUAL | — |
| lineHeight | `18.2px` | `18.2px` | `18.2px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `10px 16px` | `10px 16px` | `10px 16px` | EQUAL | — |
| margin | `0px` | `0px` | `0px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `8px` | `8px` | `8px` | EQUAL | — |
| backgroundColor | `rgb(13, 31, 51)` | `rgb(13, 31, 51)` | `rgb(13, 31, 51)` | EQUAL | — |
| color | `rgb(128, 200, 240)` | `rgb(128, 200, 240)` | `rgb(128, 200, 240)` | EQUAL | — |
| height | `38.1875px` | `38.1875px` | `38.1875px` | EQUAL | — |
| minHeight | `auto` | `auto` | `auto` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Modal / diálogo (`modal`)

Seletores: copa2026=`N/A`, br2026=`N/A`, cdb2026=`N/A`

> NOT_APPLICABLE nos três apps — nenhum modal customizado existe; toda confirmação usa window.confirm() nativo do navegador (confirmado por leitura de app.js e por CSS: 0 ocorrências de .modal nas três folhas de estilo), que não é um elemento da página e não é comparável via getComputedStyle().

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| fontSize | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| fontWeight | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| lineHeight | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| letterSpacing | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| padding | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| margin | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| gap | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| borderRadius | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| backgroundColor | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| color | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| height | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| minHeight | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
| gridTemplateColumns | `—` | `—` | `—` | N/A | component not present in enough apps to compare |
