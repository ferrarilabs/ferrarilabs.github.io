# CHANGELOG

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
