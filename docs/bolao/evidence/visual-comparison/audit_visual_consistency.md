# Auditoria de Consistência Visual — Estilos Computados (PR120-final review items 3/4/7)

Gerado em 2026-08-12T14:43:48.190Z · commit `71c97e5f` · referência visual: **copa2026** (golden master, ver CLAUDE.md).

Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em `ALLOWLIST.json`, com fonte/owner/data) · **DIVERGENT** (diferença sem entrada no allowlist — bloqueia exit 0) · **N/A** (componente não existe no app).

## Resumo

| Status | Quantidade |
|---|---|
| EQUAL | 326 |
| EQUIVALENT | 0 |
| JUSTIFIED | 24 |
| DIVERGENT | 0 |
| N/A | 70 |

## Divergências não aprovadas (DIVERGENT) — bloqueiam exit 0

Nenhuma. Todas as diferenças encontradas são EQUAL, EQUIVALENT ou JUSTIFIED (ver `ALLOWLIST.json`).

## Divergências aprovadas (JUSTIFIED) — ver ALLOWLIST.json

| Componente | Propriedade | Justificativa |
|---|---|---|
| Nav de tabs (.nav) | gridTemplateColumns | Column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real visible button count by design (fixed in this branch, commit 9b11e3b — Copa 8→6, BR2026 9→7, CDB2026 6). Unequal track widths across apps given unequal button counts is the CORRECT outcome, not a regression. If a nav button is ever added/removed in any app, the resolved track-width string changes and this exact-match entry correctly goes stale, forcing a fresh human review rather than silently continuing to approve a now-unverified state — this is the reference example the task itself asked for. [docRef: bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78 (Fase 2.2-correção item 3); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| main | height | Total rendered page length — a function of how much content each app currently has loaded (fixture size, number of phases/rounds/results), not a fixed design token. Comparing it as if it were a token would flag a DIVERGENT finding on every future content change in any app, forever, with no CSS fix possible. PR120-final review item 3 explicitly instructs: 'não compare altura total de main'. [docRef: PR120-final review item 3 (verbatim task text); docs/bolao/PLATFORM_GOVERNANCE.md; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card base (marcado) | height | The marked card (data-visual-audit="card-base", the scoring-rules card in Regras) wraps a <table class="rules-table"> whose row COUNT is tournament-specific scoring content (Copa 7 rows, BR2026 10 rows, CDB2026 6 rows) — TOURNAMENT_SPECIFIC data (CLAUDE.md: 'Diferenças específicas de torneio devem ser preservadas'), not a shared card-base token. Padding/margin/border-radius/background/font tokens on the card itself ARE compared normally (not excluded) — only the content-driven total height is excluded here. [docRef: CLAUDE.md platform governance ('Diferenças específicas de torneio devem ser preservadas — não generalizar entre apps'); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Heading do formulário (Nova entrada) | height | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Input de texto | backgroundColor | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Input de texto | color | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Input de texto | height | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Input de texto | minHeight | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Select | height | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Select | minHeight | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| Linha de ranking (.rank-row) | height | `.rank-row` CSS itself is byte-identical (`display:grid; grid-template-columns:48px 1fr auto auto; gap:10px` in all three -- verified by diffing the stylesheets directly). The height gap is a real, intentional per-app business rule, not a token: BR2026/CDB2026 gate the 'Ver palpites' button on `isPastCutoff()`/`isPastEntryCutoff()` (privacy protection -- picks stay hidden from other participants until the reveal cutoff, so no one can copy another entrant's picks before submissions close) and this harness's synthetic fixture doesn't simulate a past-cutoff state for either. Copa is fully concluded/archived (cutoff long past for the real tournament), so its ranking row always renders the 4th column. Same class of exclusion as main/card-base height above -- state-driven, not CSS-driven. [docRef: bolao/br2026/js/app.js isPastCutoff() gating comment (verbatim); bolao/cdb2026/js/app.js isPastEntryCutoff() (same pattern); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Linha de ranking (.rank-row) | gridTemplateColumns | Same root cause as ranking-row:height directly above: the grid-template-columns RULE (`48px 1fr auto auto`) is identical CSS in all three apps, but the 4th `auto` track resolves to the 'Ver palpites' button's real width in Copa (cutoff always past, button always rendered) and collapses to `0px` in BR2026/CDB2026 in this harness run (their own picks-reveal cutoff gate -- see ranking-row:height entry -- isn't simulated, so the button doesn't render at all, and an empty `auto` track has zero width). Content-driven column sizing, not a token divergence -- will resolve identically to Copa's the moment either app's synthetic run simulates a past-cutoff state. [docRef: ALLOWLIST.json ranking-row:height entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card de jogo | height | Verified with a live DOM probe (not assumed): margin/padding/gap/border-radius/colors/fonts are all EQUAL (confirmed via audit_visual_consistency.mjs's own computed-style output) — the height gap is pure fixture-content length, not a token. Copa's first .game-card__header wraps a match-badge + a longer 'Fase de grupos — Grupo A' phase label onto its own content width; BR2026's header is a single short 'Partida N' label. Copa's .game-card__metadata has 1 pill (date only, this fixture's first match has no venue set); BR2026's has 2 (date + venue). Different synthetic fixture text length per app, same class of exclusion as main/card-base/admin-toolbar height above — not a CSS/token bug, and not fixable by aligning a design token since there is none to align. [docRef: bolao/scripts/audit_visual_consistency.mjs live DOM probe, 2026-08-05 (game-card__header/__metadata innerHTML compared directly, see PR history); ALLOWLIST.json main/card-base height entries above (same exclusion class); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-05; reviewBy: 2027-08-05] |
| Badge de status de jogo (estado 'encerrado') | gap | `gap` only has a visible effect with 2+ flex children to space apart. Confirmed by reading each app's renderer: all three produce a single `<span>` with ONLY a text node inside (childElementCount:0, verified live via Playwright probe). Copa's `.status-chip` doesn't set display/gap at all (plain inline text pill); BR2026/CDB2026's `.game-status` sets `display:inline-flex; gap:4px` (kept for potential future icon use, CONSISTENCY_MATRIX item 67). With no second child to space, `gap:4px` is currently inert — zero rendered visual effect. All other properties of this exact badge state are already EQUAL across all three apps. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 67; bolao/{br2026,cdb2026}/js/app.js badge template (verbatim, single text node); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Badge de status de jogo (estado 'encerrado') | height | Copa's `.status-chip` has no `display` declared (default inline span) so `height` never resolves past the keyword 'auto'; BR2026/CDB2026's `.game-status` explicitly sets `display:inline-flex`, which DOES resolve a concrete used height. Same root cause, same CONSISTENCY_MATRIX item 72 structural difference, as the minHeight entry directly above -- newly surfaced after the copa2026 fixture storeKey fix let Copa's games section render its real archived match data through this harness for the first time this round. Zero visual difference (both render the badge at its natural content-driven size; 'auto' vs '26.5px' is the same rendered outcome via two different CSS mechanisms). [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT DOM structure); ALLOWLIST.json status-badge:minHeight entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Admin toolbar (.admin-toolbar) | height | Copa's admin toolbar has 12 buttons (CSV/JSON/HTML export variants, API-Football, ESPN sync, result emails, force sync, clear data); BR2026/CDB2026 have 4 (export CSV/JSON, force sync, clear data) — a real, intentional difference in which admin tools exist per app, not a shared design token. `.admin-toolbar` CSS itself (display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px) is identical across all three. PR120-final review item 3 explicitly instructs: 'não compare... altura de toolbar com quantidade diferente de botões' — item 6 repeats this. If Copa's tool count ever drops enough to fit one row (or BR2026/CDB2026's grows past one row), this exact value goes stale and re-flags for review, which is correct. [docRef: PR120-final review item 3 and item 6 (verbatim task text); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | fontSize | Same formalized `admin-entry-full` vs `admin-entry-dense` variant as admin-card-row:height above (see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'). `admin-entry-full` reuses Copa's `.card` base font-size (15px, same as every other `.card` in Copa); `admin-entry-dense` is a plain list row with the base body font-size (14px). Newly surfaced after the copa2026 fixture storeKey fix let Copa's admin-card-row render real comparable content for the first time this round -- not a new divergence, the same pre-existing documented one, just previously masked by the harness bug (Copa's admin-card-row was N/A, not compared, before the fix). [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | lineHeight | Direct consequence of the fontSize divergence in the entry immediately above (1.5x line-height ratio applied to each variant's own base font-size) -- same `admin-entry-full` vs `admin-entry-dense` variant, same docRef. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; ALLOWLIST.json admin-card-row:fontSize entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | padding | `admin-entry-full` is a padded `.card` (18px all sides, same as every other `.card` in the platform); `admin-entry-dense` is a plain list row with vertical-only padding (8px top/bottom, 0 horizontal -- it isn't a boxed card). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | margin | `admin-entry-full` cards stack with a bottom margin (10px, same as other `.card` instances); `admin-entry-dense` rows are spaced by the dense-list container's own `gap` instead of per-row margin (see admin-card-row:gap below). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | gap | `admin-entry-full` (a `.card`) isn't a flex/grid container itself, so `gap` computes to `normal`; `admin-entry-dense`'s dense-list row IS a flex row (spacing icon/name/actions inline), hence a real 8px gap. Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | borderRadius | `admin-entry-full` is a rounded `.card` (18px, same token as every other `.card`); `admin-entry-dense` is an unrounded list row (0px -- it's a row in a list, not a boxed card). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | backgroundColor | `admin-entry-full` has its own `.card` background token (same as every other `.card`); `admin-entry-dense` rows are transparent, relying on the dense-list container's own background instead of a per-row fill. Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| Card/linha de entrada no admin | height | Two FORMALIZED design-system variants (see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'): Copa renders each admin entry as `admin-entry-full` (a complete `.card.admin-entry`, multi-row spaced layout); BR2026/CDB2026 render `admin-entry-dense` (a single-line `.admin-row` list) — both are documented, permitted variants of the same component, not a token drift on one shared component. Same synthetic fixture content (2 fictional entries, same field names) is used for all three; only the variant differs, by design, per the design system doc's own stated criteria for when each is appropriate. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |

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
| height | `108.5px` | `108.5px` | `108.5px` | EQUAL | — |
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
| gridTemplateColumns | `203.156px 203.172px 203.172px 203.156px 203.172px 203.172px` | `173.422px 173.422px 173.438px 173.422px 173.438px 173.422px 173.438px` | `203.156px 203.172px 203.172px 203.156px 203.172px 203.172px` | JUSTIFIED | Column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real visible button count by design (fixed in this branch, commit 9b11e3b — Copa 8→6, BR2026 9→7, CDB2026 6). Unequal track widths across apps given unequal button counts is the CORRECT outcome, not a regression. If a nav button is ever added/removed in any app, the resolved track-width string changes and this exact-match entry correctly goes stale, forcing a fresh human review rather than silently continuing to approve a now-unverified state — this is the reference example the task itself asked for. [docRef: bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78 (Fase 2.2-correção item 3); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |

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
| height | `8328.97px` | `1806px` | `4653.88px` | JUSTIFIED | Total rendered page length — a function of how much content each app currently has loaded (fixture size, number of phases/rounds/results), not a fixed design token. Comparing it as if it were a token would flag a DIVERGENT finding on every future content change in any app, forever, with no CSS fix possible. PR120-final review item 3 explicitly instructs: 'não compare altura total de main'. [docRef: PR120-final review item 3 (verbatim task text); docs/bolao/PLATFORM_GOVERNANCE.md; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
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
| height | `395.391px` | `756.109px` | `444.781px` | JUSTIFIED | The marked card (data-visual-audit="card-base", the scoring-rules card in Regras) wraps a <table class="rules-table"> whose row COUNT is tournament-specific scoring content (Copa 7 rows, BR2026 10 rows, CDB2026 6 rows) — TOURNAMENT_SPECIFIC data (CLAUDE.md: 'Diferenças específicas de torneio devem ser preservadas'), not a shared card-base token. Padding/margin/border-radius/background/font tokens on the card itself ARE compared normally (not excluded) — only the content-driven total height is excluded here. [docRef: CLAUDE.md platform governance ('Diferenças específicas de torneio devem ser preservadas — não generalizar entre apps'); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
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
| height | `30px` | `30px` | `auto` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
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
| backgroundColor | `rgb(16, 37, 45)` | `rgb(16, 37, 45)` | `rgb(7, 20, 27)` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(156, 178, 185)` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| height | `44.5px` | `44.5px` | `auto` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| minHeight | `auto` | `auto` | `0px` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
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
| height | `44.5px` | `44.5px` | `auto` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| minHeight | `auto` | `auto` | `0px` | JUSTIFIED | Consequência DIRETA e INTENCIONAL do congelamento permanente do roster (Batch 0, cdb2026 v3.94+: CONFIG.entryRosterFrozen). Verificado por probe DOM ao vivo em 2026-08-07 (não inferido): em cdb2026 `#entryName` tem readOnly=true e seu `.card` ancestral tem classList.contains('hidden')=true; em br2026 os dois são false. Duas causas distintas, ambas corretas: (1) `#newEntryCard` nasce oculto (fail closed — se o JS não rodar, nenhum formulário de inscrição aparece) e só é revelado por renderNewEntryCard() quando há entrada existente carregada para edição, então altura/minHeight não resolvem para valor usado ('auto'/0px); (2) os campos de identidade são readOnly porque a identidade da entrada é IMUTÁVEL no self-service congelado, e `bolao/shared/css/forms.css:37` (`input[readonly] { background: var(--bg); color: var(--muted); }`) é a regra COMPARTILHADA do design system estilizando corretamente um campo readonly. Copa2026 está arquivada (nenhum formulário ativo) e BR2026 encerrou inscrições sem reabertura de palpites — nenhuma das duas tem roster congelado com identidade readOnly, então a diferença é TOURNAMENT_SPECIFIC, não deriva de token. Corrigir isto no CSS/UI seria REVERTER um controle de integridade que protege dinheiro real. RATIFICADO por Eduardo em 2026-08-07, após apresentação das 7 divergências com a evidência do probe DOM ao vivo (readOnly=true + .card hidden em cdb2026; ambos false em br2026) e da regra compartilhada forms.css:37. Nada foi auto-aprovado: a suíte recusa aprovação sem aprovador nomeado e as entradas ficaram 'pending' até esta ratificação. [docRef: bolao/cdb2026/js/config.js CONFIG.entryRosterFrozen; bolao/cdb2026/js/app.js renderNewEntryCard()/saveEntry(); bolao/shared/css/forms.css:37; docs/bolao/CONSISTENCY_MATRIX.md § Congelamento permanente do roster; bolao/cdb2026/CHANGELOG.md v3.94-v3.95; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-07; reviewBy: 2027-08-07] |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Form grid (.form-grid) (`form-grid`)

Seletores: copa2026=`[data-visual-audit="form-grid"]`, br2026=`[data-visual-audit="form-grid"]`, cdb2026=`[data-visual-audit="form-grid"]`

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

### Botão primário (texto sintético) (`button-primary`)

Seletores: copa2026=`[data-visual-audit="button-primary"]`, br2026=`[data-visual-audit="button-primary"]`, cdb2026=`[data-visual-audit="button-primary"]`

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

### Botão small (texto sintético) (`button-small`)

Seletores: copa2026=`[data-visual-audit="button-small"]`, br2026=`[data-visual-audit="button-small"]`, cdb2026=`[data-visual-audit="button-small"]`

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

### Botão destrutivo (texto sintético) (`button-danger`)

Seletores: copa2026=`[data-visual-audit="button-danger"]`, br2026=`[data-visual-audit="button-danger"]`, cdb2026=`[data-visual-audit="button-danger"]`

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
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `12px` | `12px` | `12px` | EQUAL | — |
| margin | `0px 0px 8px` | `0px 0px 8px` | `0px 0px 8px` | EQUAL | — |
| gap | `10px` | `10px` | `10px` | EQUAL | — |
| borderRadius | `14px` | `14px` | `14px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `65px` | `76.5px` | `76.5px` | JUSTIFIED | `.rank-row` CSS itself is byte-identical (`display:grid; grid-template-columns:48px 1fr auto auto; gap:10px` in all three -- verified by diffing the stylesheets directly). The height gap is a real, intentional per-app business rule, not a token: BR2026/CDB2026 gate the 'Ver palpites' button on `isPastCutoff()`/`isPastEntryCutoff()` (privacy protection -- picks stay hidden from other participants until the reveal cutoff, so no one can copy another entrant's picks before submissions close) and this harness's synthetic fixture doesn't simulate a past-cutoff state for either. Copa is fully concluded/archived (cutoff long past for the real tournament), so its ranking row always renders the 4th column. Same class of exclusion as main/card-base height above -- state-driven, not CSS-driven. [docRef: bolao/br2026/js/app.js isPastCutoff() gating comment (verbatim); bolao/cdb2026/js/app.js isPastEntryCutoff() (same pattern); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `48px 882.484px 18.2031px 99.3125px` | `48px 981.797px 18.2031px 0px` | `48px 882.484px 18.2031px 99.3125px` | JUSTIFIED | Same root cause as ranking-row:height directly above: the grid-template-columns RULE (`48px 1fr auto auto`) is identical CSS in all three apps, but the 4th `auto` track resolves to the 'Ver palpites' button's real width in Copa (cutoff always past, button always rendered) and collapses to `0px` in BR2026/CDB2026 in this harness run (their own picks-reveal cutoff gate -- see ranking-row:height entry -- isn't simulated, so the button doesn't render at all, and an empty `auto` track has zero width). Content-driven column sizing, not a token divergence -- will resolve identically to Copa's the moment either app's synthetic run simulates a past-cutoff state. [docRef: ALLOWLIST.json ranking-row:height entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |

### Card de jogo (`game-card`)

Seletores: copa2026=`.game-card`, br2026=`.game-card`, cdb2026=`.game-card`

> CDB2026 migrated its per-leg match cards to the same canonical .game-card as Copa/BR2026 (visual-framework-copa-canonical branch, structural DOM unification) — .confronto-card is now only the tie-group summary/aggregate wrapper, not the per-match card.

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `15px` | `15px` | EQUAL | — |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `22.5px` | `22.5px` | EQUAL | — |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `14px` | `14px` | `14px` | EQUAL | — |
| margin | `0px 0px 10px` | `0px 0px 10px` | `0px 0px 10px` | EQUAL | — |
| gap | `normal` | `normal` | `normal` | EQUAL | — |
| borderRadius | `16px` | `16px` | `16px` | EQUAL | — |
| backgroundColor | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | `rgb(13, 32, 40)` | EQUAL | — |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `152px` | `141.5px` | `152px` | JUSTIFIED | Verified with a live DOM probe (not assumed): margin/padding/gap/border-radius/colors/fonts are all EQUAL (confirmed via audit_visual_consistency.mjs's own computed-style output) — the height gap is pure fixture-content length, not a token. Copa's first .game-card__header wraps a match-badge + a longer 'Fase de grupos — Grupo A' phase label onto its own content width; BR2026's header is a single short 'Partida N' label. Copa's .game-card__metadata has 1 pill (date only, this fixture's first match has no venue set); BR2026's has 2 (date + venue). Different synthetic fixture text length per app, same class of exclusion as main/card-base/admin-toolbar height above — not a CSS/token bug, and not fixable by aligning a design token since there is none to align. [docRef: bolao/scripts/audit_visual_consistency.mjs live DOM probe, 2026-08-05 (game-card__header/__metadata innerHTML compared directly, see PR history); ALLOWLIST.json main/card-base height entries above (same exclusion class); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-05; reviewBy: 2027-08-05] |
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
| gap | `normal` | `4px` | `4px` | JUSTIFIED | `gap` only has a visible effect with 2+ flex children to space apart. Confirmed by reading each app's renderer: all three produce a single `<span>` with ONLY a text node inside (childElementCount:0, verified live via Playwright probe). Copa's `.status-chip` doesn't set display/gap at all (plain inline text pill); BR2026/CDB2026's `.game-status` sets `display:inline-flex; gap:4px` (kept for potential future icon use, CONSISTENCY_MATRIX item 67). With no second child to space, `gap:4px` is currently inert — zero rendered visual effect. All other properties of this exact badge state are already EQUAL across all three apps. [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 67; bolao/{br2026,cdb2026}/js/app.js badge template (verbatim, single text node); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| borderRadius | `999px` | `999px` | `999px` | EQUAL | — |
| backgroundColor | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | `rgba(47, 229, 110, 0.15)` | EQUAL | — |
| color | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | `rgb(47, 229, 110)` | EQUAL | — |
| height | `auto` | `26.5px` | `26.5px` | JUSTIFIED | Copa's `.status-chip` has no `display` declared (default inline span) so `height` never resolves past the keyword 'auto'; BR2026/CDB2026's `.game-status` explicitly sets `display:inline-flex`, which DOES resolve a concrete used height. Same root cause, same CONSISTENCY_MATRIX item 72 structural difference, as the minHeight entry directly above -- newly surfaced after the copa2026 fixture storeKey fix let Copa's games section render its real archived match data through this harness for the first time this round. Zero visual difference (both render the badge at its natural content-driven size; 'auto' vs '26.5px' is the same rendered outcome via two different CSS mechanisms). [docRef: docs/bolao/CONSISTENCY_MATRIX.md item 72 (INTENTIONALLY_DIFFERENT DOM structure); ALLOWLIST.json status-badge:minHeight entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
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
| height | `88.5px` | `46.5px` | `46.5px` | JUSTIFIED | Copa's admin toolbar has 12 buttons (CSV/JSON/HTML export variants, API-Football, ESPN sync, result emails, force sync, clear data); BR2026/CDB2026 have 4 (export CSV/JSON, force sync, clear data) — a real, intentional difference in which admin tools exist per app, not a shared design token. `.admin-toolbar` CSS itself (display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px) is identical across all three. PR120-final review item 3 explicitly instructs: 'não compare... altura de toolbar com quantidade diferente de botões' — item 6 repeats this. If Copa's tool count ever drops enough to fit one row (or BR2026/CDB2026's grows past one row), this exact value goes stale and re-flags for review, which is correct. [docRef: PR120-final review item 3 and item 6 (verbatim task text); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

### Card/linha de entrada no admin (`admin-card-row`)

Seletores: copa2026=`.admin-entry`, br2026=`.admin-row`, cdb2026=`.admin-row`

> Copa renders each admin entry as a full `.card.admin-entry`; BR2026/CDB2026 use a dense `.admin-row` list — CONSISTENCY_MATRIX.md item 78, NEEDS_REVIEW, deliberately not converted (admin-only screen, list can be long) — documented divergence, not an oversight.

| Propriedade | copa2026 | br2026 | cdb2026 | Status | Motivo |
|---|---|---|---|---|---|
| fontFamily | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | `Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | EQUAL | — |
| fontSize | `15px` | `14px` | `14px` | JUSTIFIED | Same formalized `admin-entry-full` vs `admin-entry-dense` variant as admin-card-row:height above (see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'). `admin-entry-full` reuses Copa's `.card` base font-size (15px, same as every other `.card` in Copa); `admin-entry-dense` is a plain list row with the base body font-size (14px). Newly surfaced after the copa2026 fixture storeKey fix let Copa's admin-card-row render real comparable content for the first time this round -- not a new divergence, the same pre-existing documented one, just previously masked by the harness bug (Copa's admin-card-row was N/A, not compared, before the fix). [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| fontWeight | `400` | `400` | `400` | EQUAL | — |
| lineHeight | `22.5px` | `21px` | `21px` | JUSTIFIED | Direct consequence of the fontSize divergence in the entry immediately above (1.5x line-height ratio applied to each variant's own base font-size) -- same `admin-entry-full` vs `admin-entry-dense` variant, same docRef. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; ALLOWLIST.json admin-card-row:fontSize entry above (same root cause); owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| letterSpacing | `normal` | `normal` | `normal` | EQUAL | — |
| padding | `18px` | `8px 0px` | `8px 0px` | JUSTIFIED | `admin-entry-full` is a padded `.card` (18px all sides, same as every other `.card` in the platform); `admin-entry-dense` is a plain list row with vertical-only padding (8px top/bottom, 0 horizontal -- it isn't a boxed card). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| margin | `0px 0px 10px` | `0px` | `0px` | JUSTIFIED | `admin-entry-full` cards stack with a bottom margin (10px, same as other `.card` instances); `admin-entry-dense` rows are spaced by the dense-list container's own `gap` instead of per-row margin (see admin-card-row:gap below). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| gap | `normal` | `8px` | `8px` | JUSTIFIED | `admin-entry-full` (a `.card`) isn't a flex/grid container itself, so `gap` computes to `normal`; `admin-entry-dense`'s dense-list row IS a flex row (spacing icon/name/actions inline), hence a real 8px gap. Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| borderRadius | `18px` | `0px` | `0px` | JUSTIFIED | `admin-entry-full` is a rounded `.card` (18px, same token as every other `.card`); `admin-entry-dense` is an unrounded list row (0px -- it's a row in a list, not a boxed card). Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| backgroundColor | `rgb(13, 32, 40)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | JUSTIFIED | `admin-entry-full` has its own `.card` background token (same as every other `.card`); `admin-entry-dense` rows are transparent, relying on the dense-list container's own background instead of a per-row fill. Formalized variant, see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| color | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | `rgb(238, 247, 241)` | EQUAL | — |
| height | `149.5px` | `87.5px` | `128px` | JUSTIFIED | Two FORMALIZED design-system variants (see docs/bolao/DESIGN_SYSTEM.md § 'Admin entry row — full vs. dense variant'): Copa renders each admin entry as `admin-entry-full` (a complete `.card.admin-entry`, multi-row spaced layout); BR2026/CDB2026 render `admin-entry-dense` (a single-line `.admin-row` list) — both are documented, permitted variants of the same component, not a token drift on one shared component. Same synthetic fixture content (2 fictional entries, same field names) is used for all three; only the variant differs, by design, per the design system doc's own stated criteria for when each is appropriate. [docRef: docs/bolao/DESIGN_SYSTEM.md § Admin entry row — full vs. dense variant; docs/bolao/CONSISTENCY_MATRIX.md item 78; owner: Platform; approvedBy: Eduardo; reviewDate: 2026-08-03; reviewBy: 2027-08-03] |
| minHeight | `0px` | `0px` | `0px` | EQUAL | — |
| gridTemplateColumns | `none` | `none` | `none` | EQUAL | — |

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
| borderRadius | `12px` | `12px` | `12px` | EQUAL | — |
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
