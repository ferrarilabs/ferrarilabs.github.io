/**
 * audit_visual_consistency.mjs — cross-app computed-style consistency audit (Fase 2.2-correção
 * item 7 / coordinator #2; rewritten for PR120-final review items 3/4/7).
 *
 * Run:  node bolao/scripts/audit_visual_consistency.mjs
 *
 * Deliberately lives at `bolao/scripts/` (NOT under any single app's `scripts/`) — this is
 * cross-app tooling, unlike everything under `bolao/cdb2026/scripts/`, which is CDB2026-owned
 * (even the shared visual-evidence harness there is CDB2026-rooted by convention/history, see
 * `docs/bolao/PLATFORM_GOVERNANCE.md`). Reuses `playwright_loader.mjs` and (new) `game_fixtures.mjs`
 * from `bolao/cdb2026/scripts/visual/` rather than duplicating them.
 *
 * PR120-final review — what changed here and why:
 *
 * 1. (item 3) Ambiguous selectors replaced with unambiguous ones. The previous version compared
 *    the FIRST `.card`/`h3` in each app's DOM — not the same semantic element per app (e.g. Copa's
 *    first `.card` is its entry-form card, which has its own simulator grid layout; BR2026/
 *    CDB2026's first `.card` is a plain card) — and `.small-btn`/`.danger` picked up whichever
 *    button happened to be first, with different text length driving different heights. Fixed:
 *    `data-visual-audit="card-base"|"rules-heading"|"button-primary"|"button-danger"|
 *    "button-small"` attributes (purely additive, zero CSS/behavior change — see the comments at
 *    each attribute's call site in `bolao/{app}/js/app.js` / `index.html`) give every one of these
 *    a single, stable, semantically-equivalent target in all three apps. `h2[data-i18n=
 *    "entryTitle"]` (already unique in all three apps, no new attribute needed) adds the
 *    previously-missing "heading do formulário" component the task named explicitly.
 * 2. (item 3) Button height comparisons are now fair: `normalizeSyntheticButtonText()` overwrites
 *    button-primary/button-danger/button-small's `textContent` to the SAME synthetic string in
 *    every app, in this harness's own ephemeral page only (never touches source files) — before,
 *    different real i18n label lengths (e.g. "CSV completo" vs "CSV") made height differences look
 *    like a token bug when they were actually a content-length artifact.
 * 3. (item 3) `height`/`minHeight` on `main`/`topbar`/`admin-toolbar`/`card-base` are no longer
 *    compared at all — see docs/bolao/evidence/visual-comparison/ALLOWLIST.json, which documents
 *    WHY for each (page-total content length, nav-wrap content length, admin-tool-count content
 *    length, rules-table-row-count content length — none are design tokens).
 * 4. (item 5) Game/status-badge components now get REAL, comparable data in all three apps via
 *    `bolao/cdb2026/scripts/visual/game_fixtures.mjs` (BR2026's sessionStorage schedule seed,
 *    CDB2026's richer tie fixture + ESPN mock, Copa's harness-only Jogos-nav unhide) — the
 *    previous version had `.game-card:padding` etc. reading BR2026 as `null` (no games ever
 *    rendered) because ESPN was mocked empty with no fallback.
 * 5. (item 7) DIVERGENT findings are now checked against a VERSIONED allowlist
 *    (`docs/bolao/evidence/visual-comparison/ALLOWLIST.json` — component, property, apps,
 *    justification, docRef, owner, reviewDate) instead of an inline JS object living only in this
 *    file's source. Exit code is 0 iff there are zero UNAPPROVED DIVERGENT findings (present in
 *    neither the allowlist nor resolved by the item 4 CSS alignment) — matching the review's
 *    explicit acceptance criterion.
 *
 * What this does: loads all three apps with a synthetic data fixture AND a synthetic admin
 * session (same sessionStorage-key technique verified for `capture_admin_auth_evidence.mjs`, real
 * password never used), clicks through the sections each component actually needs to be visible
 * in (entry/ranking/games/rules/admin), reads `getComputedStyle()` for ~28 named components, and
 * classifies every property-level comparison as:
 *
 *   EQUAL       — identical computed value in every app where the component exists.
 *   EQUIVALENT  — different string but the same rendered effect (e.g. "0px" vs "" for an unset
 *                 shorthand that resolves to the same box) -- used sparingly, see isEquivalent().
 *   JUSTIFIED   — different value, matched against a dated, sourced entry in ALLOWLIST.json.
 *   DIVERGENT   — different value, no allowlist entry found. Flagged for human review, blocks a
 *                 clean exit.
 *   N/A         — the component doesn't exist in that app's DOM at all (e.g. CDB2026's
 *                 `.confronto-card` has no equivalent selector reused from Copa's `.game-card` --
 *                 struct is intentionally different per CONSISTENCY_MATRIX.md item 72).
 *
 * Copa's archived mode: `capture_evidence.mjs` (screenshot evidence for real users) correctly
 * marks Copa's non-Ranking sections `notApplicable` for MOST sections, because CONFIG.archived
 * hides those nav buttons for real visitors and that screenshot harness is about what a visitor
 * actually sees. THIS script has a different purpose — internal design-token comparison, not
 * user-facing evidence — and the original Fase 2.2-correção task explicitly permitted forcing/
 * simulating Palpites/Jogos/Regras/Admin views for Copa "só via funções locais, fixtures e
 * sessionStorage sintético no contexto do harness Playwright" for exactly this kind of comparison.
 * So here (and only here) the relevant nav button's `.hidden` class is removed client-side, in
 * this harness's own browser context, before clicking it — applyArchiveMode() and every other
 * production file are untouched; nothing here would let a real visitor reach it.
 */
import { loadChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";
import { cdb2026TiesFixture, routeCdb2026Espn, seedBr2026Schedule } from "../cdb2026/scripts/visual/game_fixtures.mjs";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8191; // distinct from capture_evidence.mjs (8189) / capture_admin_auth_evidence.mjs (8190)
const OUT_DIR = join(ROOT, "docs", "bolao", "evidence", "visual-comparison");
const ALLOWLIST_PATH = join(OUT_DIR, "ALLOWLIST.json");
const FIXTURE_ID = "visual-comparable-v1";
const REFERENCE_APP = "copa2026"; // golden master per CLAUDE.md / DESIGN_SYSTEM.md

// Same fixed synthetic strings in every app — see file header point 2. Deliberately short (fits
// every app's button without wrapping) and visibly NOT a real i18n string, so nobody mistakes this
// for a real production label if a screenshot of this harness run is ever shared.
const SYNTHETIC_BUTTON_TEXT = {
  "button-primary": "Confirmar teste",
  "button-danger": "Remover teste",
  "button-small": "Sincronizar",
};

const PROPERTIES = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "padding", "margin", "gap", "borderRadius", "backgroundColor", "color",
  "height", "minHeight", "gridTemplateColumns",
];

// ── Fixtures (fictional data only) ──────────────────────────────────────────────────────────
function cdb2026Fixture() {
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: { matches: {}, qualified: {} } },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: { matches: {}, qualified: {} } },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    // PR120-final review item 5: sourced from the shared game_fixtures.mjs module (was a single
    // scheduled leg — see that module's header for the full agendado/finalizado/adiado/ao vivo/
    // nome longo/estádio/ida-volta-agregado coverage this now provides).
    phases: cdb2026TiesFixture(),
    espnSync: { activePhaseId: "oitavas", seededKnownConfrontos: true, backfilledOitavasKickoffs: true, healedFalseAutoResults: true, healedPhantomTies: true },
    auditLog: [], meta: { updatedAt: null, version: FIXTURE_ID },
  };
}
function br2026Fixture() {
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: {} },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: {} },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false }, meta: { updatedAt: null, version: FIXTURE_ID },
  };
}
// capture_evidence.mjs deliberately uses NO fixture for Copa (screenshot evidence should show
// the real archived/concluded state). This script's purpose is different (CSS token comparison,
// needs at least one rendered `.rank-row`/`.admin-entry` to read styles from), so it gets its own
// minimal fictional fixture, not a contradiction of that earlier decision -- just a different
// purpose. Games/rules/entry render from Copa's own REAL (already public) archived data once the
// harness clears `.hidden`/`disabled` on those nav buttons (see the section-visit loop in
// extractStylesForApp()) — no games fixture needed for Copa here either.
function copa2026Fixture() {
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", paymentMethod: "CashApp", picks: {} },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", paymentMethod: "Zelle", picks: {} },
    ],
    paid: { "fx-1": true, "fx-2": false }, results: {}, deletedIds: [], meta: { updatedAt: null, version: FIXTURE_ID },
  };
}

const APPS = {
  copa2026: {
    // PR120-final review item 2 investigation: was "bolao_copa2026_state" (no underscore between
    // "copa" and "2026") -- doesn't match the real key Copa's own js/config.js declares
    // (`storeKey: "bolao_copa_2026_state"`, see CLAUDE.md "State" section). The fixture was
    // silently written to a dead key every run; Copa's app never read it, fell through to the
    // mocked-empty Supabase response, rendered zero admin entries, and admin-card-row came back
    // N/A for Copa only -- a harness bug, not a real product divergence. br2026/cdb2026's keys
    // were already correct (verified against their own config.js).
    path: "/bolao/copa2026/", storeKey: "bolao_copa_2026_state", fixture: copa2026Fixture(),
    seedAdmin: (until) => ({ adminOk: "true", adminUntil: String(until) }),
  },
  br2026: {
    path: "/bolao/br2026/", storeKey: "bolao_br2026_state", fixture: br2026Fixture(),
    seedAdmin: (until) => ({ br2026_adminUntil: String(until) }),
    seedSchedule: true, // PR120-final review item 5 — see extractStylesForApp()
  },
  cdb2026: {
    path: "/bolao/cdb2026/", storeKey: "bolao_cdb2026_state", fixture: cdb2026Fixture(),
    seedAdmin: (until) => ({ cdb2026_adminUntil: String(until) }),
    mockEspn: true, // PR120-final review item 5 — see extractStylesForApp()
  },
};

// Which section must be the active `.page` for a component's computed style to reflect its real
// rendered state. `null` = present/readable regardless of which section is active (header/nav
// chrome, or `main` itself). Layout-INdependent properties (padding/margin/border-radius/colors)
// actually resolve correctly via getComputedStyle() even under a `display:none` ancestor, but
// layout-DEpendent ones (height, gap in some engines) do not — reading every component from its
// real active section avoids relying on that distinction being right for every property checked.
const SECTION_FOR_COMPONENT = {
  topbar: null, brand: null, "competition-selector": null, "lang-button": null,
  "lang-button-active": null, "tabs-nav": null, "tab-button": null, "tab-button-active": null,
  main: null,
  "card-base": "rules", "rules-heading": "rules", "rules-table-cell": "rules",
  "form-heading": "entry", "input-text": "entry", select: "entry", "form-grid": "entry",
  "button-primary": "entry",
  "ranking-row": "ranking",
  "game-card": "games", "status-badge": "games",
  "paid-badge": "admin", "admin-toolbar": "admin", "admin-card-row": "admin",
  "button-small": "admin", "button-danger": "admin", "button-secondary": "admin",
  "whatsapp-btn": null,
  // PR120-final review item 6: toast is a fixed-position overlay (position:fixed, z-index:10000)
  // triggered explicitly below (see TOAST_TRIGGER_TEXT / extractStylesForApp) — its computed
  // style doesn't depend on which `.page` is active, so `null` (read in the __always bucket) is
  // correct, same as topbar/main.
  toast: null,
};

// ── Components — id, human label, per-app selector (null = doesn't exist in that app), note ──
const COMPONENTS = [
  { id: "topbar", label: "Topbar", selectors: { copa2026: ".topbar", br2026: ".topbar", cdb2026: ".topbar" } },
  { id: "brand", label: "Brand / logo", selectors: { copa2026: ".brand", br2026: ".brand", cdb2026: ".brand" } },
  { id: "competition-selector", label: "Seletor de competição (Alternar bolão)", selectors: { copa2026: ".bolao-switcher", br2026: ".bolao-switcher", cdb2026: ".bolao-switcher" } },
  { id: "lang-button", label: "Botão de idioma", selectors: { copa2026: ".lang-links button", br2026: ".lang-links button", cdb2026: ".lang-links button" } },
  { id: "lang-button-active", label: "Botão de idioma ativo", selectors: { copa2026: ".lang-links button.active", br2026: ".lang-links button.active", cdb2026: ".lang-links button.active" } },
  { id: "tabs-nav", label: "Nav de tabs (.nav)", selectors: { copa2026: ".nav", br2026: ".nav", cdb2026: ".nav" } },
  // `[data-section="ranking"]`, not the generic `.nav button:not(.active)` -- the generic form
  // picked Copa's FIRST non-active button in DOM order, which in archived mode is "Palpites"
  // carrying the `.hidden` class (display:none), producing a bogus height:auto vs 44px
  // "divergence" that was really just a selector artifact, not a real style difference. Ranking
  // is never hidden and never the active section after this script clicks into Admin, in any app.
  { id: "tab-button", label: "Botão de tab (inativo)", selectors: { copa2026: '[data-section="ranking"]', br2026: '[data-section="ranking"]', cdb2026: '[data-section="ranking"]' } },
  { id: "tab-button-active", label: "Botão de tab ativo", selectors: { copa2026: ".nav button.active", br2026: ".nav button.active", cdb2026: ".nav button.active" } },
  { id: "main", label: "main", selectors: { copa2026: "main", br2026: "main", cdb2026: "main" } },
  // PR120-final review item 3: was the ambiguous first `.card` in DOM order (could be a
  // structurally different card per app, e.g. Copa's entry-form card has its own simulator grid).
  // `data-visual-audit="card-base"` marks the SAME semantic element in all three apps: the plain
  // `.card` wrapping the scoring-rules table in Regras (see renderRules() in each app's app.js).
  { id: "card-base", label: "Card base (marcado)", selectors: { copa2026: '[data-visual-audit="card-base"]', br2026: '[data-visual-audit="card-base"]', cdb2026: '[data-visual-audit="card-base"]' } },
  { id: "h2", label: "h2", selectors: { copa2026: "h2", br2026: "h2", cdb2026: "h2" } },
  // PR120-final review item 3: was the ambiguous first `h3` in DOM order. `rules-heading` is the
  // "section heading de Regras" example the task names explicitly (the scoring-rules subheading).
  { id: "rules-heading", label: "Heading de seção (Regras)", selectors: { copa2026: '[data-visual-audit="rules-heading"]', br2026: '[data-visual-audit="rules-heading"]', cdb2026: '[data-visual-audit="rules-heading"]' } },
  // PR120-final review item 3: "heading do formulário" example the task names explicitly. Already
  // unique per app via the existing data-i18n attribute — no new markup needed.
  { id: "form-heading", label: "Heading do formulário (Nova entrada)", selectors: { copa2026: 'h2[data-i18n="entryTitle"]', br2026: 'h2[data-i18n="entryTitle"]', cdb2026: 'h2[data-i18n="entryTitle"]' } },
  // #entryName verified present with this exact id in all three apps (not a generic `input[type=
  // text]` match, which is ambiguous in CDB2026 — it also has #findEntryCode as input[type=text]).
  { id: "input-text", label: "Input de texto", selectors: { copa2026: "#entryName", br2026: "#entryName", cdb2026: "#entryName" } },
  // #paymentMethod explicitly in all three (verified: all three index.html files have this exact
  // id) -- NOT a generic `select` tag match, which would pick up `#bolaoSelect` (the competition
  // switcher pill, earlier in the DOM and styled completely differently) instead, silently
  // comparing the wrong element between apps.
  { id: "select", label: "Select", selectors: { copa2026: "#paymentMethod", br2026: "#paymentMethod", cdb2026: "#paymentMethod" } },
  // PR120-final review item 7 investigation: CDB2026 has TWO `.form-grid` elements in its DOM
  // (the hidden `#findEntryCard` "editar entrada" form AND the real "Nova entrada" form) — the
  // generic `.form-grid` selector picked up the FIRST one in DOM order, which is inside a
  // `.hidden` (display:none) ancestor. A `display:none` element never gets a layout box, so
  // `getComputedStyle` can't resolve `gridTemplateColumns` to real pixel tracks (returns the
  // unresolved `repeat(2, minmax(0px, 1fr))` string instead) and reports a bogus `height:auto` —
  // this was a harness selector bug, not a real CSS divergence (confirmed: once pointed at the
  // real, visible form-grid, CDB2026's gridTemplateColumns is `527px 527px`, byte-identical to
  // Copa/BR2026). Copa/BR2026 only ever had one `.form-grid` each, so this didn't affect them —
  // the marker is added to all three for a uniform, future-proof selector strategy, matching the
  // same "ambiguous first-match" bug class item 3 already fixed for `.card`/`h3`/`.small-btn`.
  { id: "form-grid", label: "Form grid (.form-grid)", selectors: { copa2026: '[data-visual-audit="form-grid"]', br2026: '[data-visual-audit="form-grid"]', cdb2026: '[data-visual-audit="form-grid"]' } },
  // PR120-final review item 3: "botão primário com mesmo texto sintético" — data-visual-audit
  // gives a uniform selector across the three apps' differing real ids (#saveEntry vs
  // #saveEntryBtn); normalizeSyntheticButtonText() (below) overwrites its text at capture time.
  { id: "button-primary", label: "Botão primário (texto sintético)", selectors: { copa2026: '[data-visual-audit="button-primary"]', br2026: '[data-visual-audit="button-primary"]', cdb2026: '[data-visual-audit="button-primary"]' } },
  // PR120-final review item 3: was the ambiguous first `.small-btn` in DOM order (Copa's first
  // is "CSV completo", BR2026/CDB2026's first is "CSV" — different text length driving different
  // height even though the CSS rule is byte-identical in all three). Now marks the one button that
  // is semantically the same action (force remote sync) in all three apps, text normalized below.
  { id: "button-small", label: "Botão small (texto sintético)", selectors: { copa2026: '[data-visual-audit="button-small"]', br2026: '[data-visual-audit="button-small"]', cdb2026: '[data-visual-audit="button-small"]' } },
  // Already the single unambiguous `.danger` button in every app (only one exists per app) — the
  // data-visual-audit marker makes that explicit/stable rather than implicit, and its text is
  // normalized below same as button-primary/button-small.
  { id: "button-danger", label: "Botão destrutivo (texto sintético)", selectors: { copa2026: '[data-visual-audit="button-danger"]', br2026: '[data-visual-audit="button-danger"]', cdb2026: '[data-visual-audit="button-danger"]' } },
  // PR120-final review item 6: "botão secundário" named explicitly, distinct from button-small
  // (which is `.secondary.small-btn`, a different size tier). `#adminLogoutBtn` ("Sair") is a
  // plain full-size `.secondary` button (no `.small-btn`), same id/markup/position (first button
  // in .admin-toolbar) in all three apps — no new marker needed, the id is already unique/stable.
  { id: "button-secondary", label: "Botão secundário (Sair)", selectors: { copa2026: "#adminLogoutBtn", br2026: "#adminLogoutBtn", cdb2026: "#adminLogoutBtn" } },
  { id: "ranking-row", label: "Linha de ranking (.rank-row)", selectors: { copa2026: ".rank-row", br2026: ".rank-row", cdb2026: ".rank-row" } },
  { id: "game-card", label: "Card de jogo", selectors: { copa2026: ".game-card", br2026: ".game-card", cdb2026: ".confronto-card" }, note: "CDB2026 uses .confronto-card (ida+volta layout) instead of .game-card by design — CONSISTENCY_MATRIX.md item 72, INTENTIONALLY_DIFFERENT (tournament format, not a shared component)." },
  // PR120-final review item 3: was the ambiguous first `.status-chip`/`.game-status` in DOM
  // order — different apps/fixtures sort a different STATUS first (live/postponed/scheduled/
  // final legitimately have different colors by design), so "first match" could silently compare
  // a live badge in one app against a postponed badge in another — not a token bug, an
  // apples-to-oranges selector mistake. Pinned to the "final/encerrado" state specifically
  // (`.done`/`.post`), the one state guaranteed present in all three apps' fixtures (Copa's real
  // archived tournament data is ALL final; BR2026/CDB2026's synthetic fixtures both include a
  // finished match — see game_fixtures.mjs).
  { id: "status-badge", label: "Badge de status de jogo (estado 'encerrado')", selectors: { copa2026: ".status-chip.done", br2026: ".game-status.post", cdb2026: ".game-status.post" }, note: "Class names differ by app (CONSISTENCY_MATRIX.md item 67: '.status-chip' vs '.game-status', kept per-app deliberately to avoid JS renaming risk) — CSS visual treatment is what's compared here, not the selector name." },
  { id: "paid-badge", label: "Badge de pagamento (.paid-badge)", selectors: { copa2026: ".paid-badge", br2026: ".paid-badge", cdb2026: ".paid-badge" } },
  { id: "admin-toolbar", label: "Admin toolbar (.admin-toolbar)", selectors: { copa2026: ".admin-toolbar", br2026: ".admin-toolbar", cdb2026: ".admin-toolbar" } },
  { id: "admin-card-row", label: "Card/linha de entrada no admin", selectors: { copa2026: ".admin-entry", br2026: ".admin-row", cdb2026: ".admin-row" }, note: "Copa renders each admin entry as a full `.card.admin-entry`; BR2026/CDB2026 use a dense `.admin-row` list — CONSISTENCY_MATRIX.md item 78, NEEDS_REVIEW, deliberately not converted (admin-only screen, list can be long) — documented divergence, not an oversight." },
  { id: "rules-table-cell", label: "Célula de tabela de regras (.rules-table td)", selectors: { copa2026: ".rules-table td", br2026: ".rules-table td", cdb2026: ".rules-table td" } },
  { id: "whatsapp-button", label: "Botão WhatsApp (.whatsapp-btn)", selectors: { copa2026: ".whatsapp-btn", br2026: ".whatsapp-btn", cdb2026: ".whatsapp-btn" } },
  // PR120-final review item 6: "toast" named explicitly among the admin-adjacent components to
  // capture in isolation. Triggered via each app's own `showToast()` (see TOAST_TRIGGER_TEXT
  // below) — a real, existing component (`.bolao-toast.info`), not a new one built for this audit.
  { id: "toast", label: "Toast (notificação)", selectors: { copa2026: ".bolao-toast.info", br2026: ".bolao-toast.info", cdb2026: ".bolao-toast.info" } },
  // PR120-final review item 6: "modal" named explicitly among the components to capture. Verified
  // by reading all three apps' app.js — there is NO custom modal/dialog component in any of the
  // three (confirmed: `grep -c "\.modal\b"` across all three CSS files is 0). Every confirmation
  // flow (draft restore, extreme-score warning, bulk result email, overwrite picks) uses the
  // browser's native `window.confirm()`, which is OS/browser chrome, not a page-rendered element
  // — there is nothing for `getComputedStyle()` to read, and it would be the same native dialog
  // in all three apps regardless of which app triggered it (nothing to compare). Listed with all
  // three selectors `null` so it appears as an explicit N/A row in the report rather than being
  // silently absent — matching item 6's instruction that functional gaps be NOT_APPLICABLE, not
  // silently skipped.
  { id: "modal", label: "Modal / diálogo", selectors: { copa2026: null, br2026: null, cdb2026: null }, note: "NOT_APPLICABLE nos três apps — nenhum modal customizado existe; toda confirmação usa window.confirm() nativo do navegador (confirmado por leitura de app.js e por CSS: 0 ocorrências de .modal nas três folhas de estilo), que não é um elemento da página e não é comparável via getComputedStyle()." },
];

// PR120-final review item 6: text used to trigger a real toast in each app's own `showToast()` —
// a long duration (60s) keeps it in the DOM well past every other section-visit this script does,
// so timing never matters for reading its computed style in the `__always` bucket.
const TOAST_TRIGGER_TEXT = "Teste de notificação (harness)";

// ── Allowlist (item 7, hardened per PR120-final review "evidence/allowlist" round) — versioned,
// external, reviewable. See ALLOWLIST.json's own $schema note. This is the ONLY mechanism that can
// turn a DIVERGENT finding into JUSTIFIED — every entry is validated strictly (required fields,
// known component/property/app names, approvalStatus==='approved', reviewBy not expired) BEFORE
// it's trusted, and every entry must actually match a real finding this run or the script fails —
// an allowlist entry sitting unused is exactly as much a defect as an unapproved DIVERGENT.
const REQUIRED_FIELDS = ["component", "property", "apps", "expectedType", "expected", "justification", "docRef", "owner", "approvalStatus", "approvedBy", "reviewDate", "reviewBy"];
const KNOWN_PROPERTIES = new Set(PROPERTIES);
const KNOWN_COMPONENT_IDS = new Set(COMPONENTS.map(c => c.id));
const KNOWN_APP_IDS = new Set(Object.keys(APPS));

function isoDateInPast(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d.getTime() < Date.now();
}

// Validates ONE allowlist entry's own shape/references, independent of whether it matches any
// real finding this run. Returns a list of problems (empty = structurally valid). This runs on
// EVERY entry up front, so a malformed entry is reported once, clearly, rather than silently
// failing to match later and looking like a plain "unused" entry with no explanation.
function validateAllowlistEntrySchema(entry, index) {
  const problems = [];
  const where = `entries[${index}] (component=${JSON.stringify(entry.component)}, property=${JSON.stringify(entry.property)})`;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) problems.push(`${where}: campo obrigatório ausente: "${field}"`);
  }
  if (problems.length) return problems; // don't cascade into null-deref checks below
  if (typeof entry.component !== "string" || !KNOWN_COMPONENT_IDS.has(entry.component)) {
    problems.push(`${where}: componente inexistente ("${entry.component}" não está na lista COMPONENTS deste script)`);
  }
  if (typeof entry.property !== "string" || !KNOWN_PROPERTIES.has(entry.property)) {
    problems.push(`${where}: propriedade inexistente ("${entry.property}" não está em PROPERTIES)`);
  }
  if (!Array.isArray(entry.apps) || entry.apps.length === 0) {
    problems.push(`${where}: "apps" precisa ser um array não-vazio de app IDs`);
  } else {
    for (const app of entry.apps) {
      if (!KNOWN_APP_IDS.has(app)) problems.push(`${where}: app inválido em "apps": "${app}"`);
    }
  }
  if (entry.expectedType !== "exact" && entry.expectedType !== "content-driven") {
    problems.push(`${where}: expectedType precisa ser "exact" ou "content-driven", recebeu ${JSON.stringify(entry.expectedType)}`);
  }
  if (entry.expectedType === "exact") {
    if (!entry.expected || typeof entry.expected !== "object") {
      problems.push(`${where}: expectedType="exact" exige "expected" como objeto {app: valor}`);
    } else if (Array.isArray(entry.apps)) {
      for (const app of entry.apps) {
        if (!(app in entry.expected)) problems.push(`${where}: "expected" não tem valor para o app "${app}" listado em "apps"`);
      }
    }
  }
  if (entry.approvalStatus !== "approved" && entry.approvalStatus !== "pending") {
    problems.push(`${where}: approvalStatus precisa ser "approved" ou "pending", recebeu ${JSON.stringify(entry.approvalStatus)}`);
  }
  if (entry.approvalStatus === "approved" && !entry.approvedBy) {
    problems.push(`${where}: approvalStatus="approved" mas "approvedBy" está vazio — nenhuma aprovação automática por "task authorization" genérica é aceita, precisa de um aprovador nomeado`);
  }
  if (typeof entry.reviewBy !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy)) {
    problems.push(`${where}: "reviewBy" precisa ser uma data ISO (YYYY-MM-DD)`);
  } else if (isoDateInPast(entry.reviewBy)) {
    problems.push(`${where}: aprovação EXPIRADA — reviewBy=${entry.reviewBy} já passou, precisa de nova revisão antes de continuar suprimindo este achado`);
  }
  return problems;
}

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const schemaProblems = [];
  const map = new Map(); // key `${component}:${property}` -> validated entry (only if schema-valid)
  raw.entries.forEach((entry, i) => {
    const problems = validateAllowlistEntrySchema(entry, i);
    if (problems.length) { schemaProblems.push(...problems); return; }
    map.set(`${entry.component}:${entry.property}`, { ...entry, used: false });
  });
  return { map, schemaProblems };
}

function isEquivalent(a, b) {
  // Treat "0px"/"0px 0px"/"0px 0px 0px 0px" as equivalent shorthand expansions of the same box,
  // and trim whitespace-only differences. Deliberately conservative — most things should resolve
  // via EQUAL or get a real look, not be waved through here.
  const norm = v => (v || "").replace(/\s+/g, " ").trim();
  if (norm(a) === norm(b)) return true;
  const zero = /^(0px)(\s0px){0,3}$/;
  if (zero.test(norm(a)) && zero.test(norm(b))) return true;
  return false;
}

// Hardened per PR120-final review items 2/3/4: an allowlist entry only suppresses a DIVERGENT
// finding when component+property match AND the app SET matches exactly (not a superset/subset)
// AND approvalStatus is "approved" (never "pending") AND reviewBy hasn't expired AND, for
// expectedType:"exact" entries, every app's CURRENT value matches the entry's stored "expected"
// value byte-for-byte — a value that has drifted since the entry was written is exactly as
// unapproved as a finding with no entry at all, not silently waved through.
function classify(componentId, property, valuesByApp, allowlist) {
  const present = Object.entries(valuesByApp).filter(([, v]) => v !== null);
  if (present.length <= 1) return { status: "N/A", reason: "component not present in enough apps to compare" };
  const [, firstVal] = present[0];
  const allEqual = present.every(([, v]) => v === firstVal);
  if (allEqual) return { status: "EQUAL" };
  const allEquivalent = present.every(([, v]) => isEquivalent(v, firstVal));
  if (allEquivalent) return { status: "EQUIVALENT" };

  const entry = allowlist.get(`${componentId}:${property}`);
  if (!entry) return { status: "DIVERGENT", reason: null };

  const presentAppSet = new Set(present.map(([app]) => app));
  const entryAppSet = new Set(entry.apps);
  const sameAppSet = presentAppSet.size === entryAppSet.size && [...presentAppSet].every(a => entryAppSet.has(a));
  if (!sameAppSet) {
    return { status: "DIVERGENT", reason: `ALLOWLIST STALE: entrada existe para "${componentId}:${property}" mas o conjunto de apps não bate (entrada: ${[...entryAppSet].join(",")}; achado atual: ${[...presentAppSet].join(",")}) — precisa de revisão antes de suprimir.` };
  }
  if (entry.approvalStatus !== "approved") {
    return { status: "DIVERGENT", reason: `PENDING APPROVAL: entrada existe para "${componentId}:${property}" mas approvalStatus="${entry.approvalStatus}", não "approved" — não pode suprimir até ser explicitamente aprovada.` };
  }
  if (isoDateInPast(entry.reviewBy)) {
    return { status: "DIVERGENT", reason: `EXPIRED APPROVAL: entrada para "${componentId}:${property}" tinha reviewBy=${entry.reviewBy}, já expirou — precisa de nova revisão.` };
  }
  if (entry.expectedType === "exact") {
    const mismatches = present.filter(([app, v]) => entry.expected[app] !== v);
    if (mismatches.length) {
      const detail = mismatches.map(([app, v]) => `${app}: esperado "${entry.expected[app]}", atual "${v}"`).join("; ");
      return { status: "DIVERGENT", reason: `VALUE DRIFT: entrada aprovada para "${componentId}:${property}" é expectedType="exact", mas o valor atual não bate mais com o autorizado (${detail}) — a entrada ficou desatualizada, precisa de nova revisão/atualização, não é mais coberta pela aprovação existente.` };
    }
  }
  // content-driven entries accept any differing value once app-set/approval/expiry all check out —
  // that's the whole point of this expectedType (the exact number is expected to vary by content).

  entry.used = true; // only mark used once it genuinely suppressed a real finding this run
  const reason = `${entry.justification} [docRef: ${entry.docRef}; owner: ${entry.owner}; approvedBy: ${entry.approvedBy}; reviewDate: ${entry.reviewDate}; reviewBy: ${entry.reviewBy}]`;
  return { status: "JUSTIFIED", reason };
}

function commitHash() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { return "unknown"; }
}
function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
    p.on("error", reject);
    setTimeout(() => resolve(p), 700);
  });
}

async function extractStylesForApp(browser, appId, app) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
  await context.route("**://*.supabase.co/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route("**://*.emailjs.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  // PR120-final review item 5: CDB2026's ao-vivo/adiado game-card/status-badge states are
  // resolved by the app's own ESPN-matching logic, so it gets the realistic mock; every other app
  // gets the plain empty-response mock this harness has always used (registered first so
  // routeCdb2026Espn's more specific registration below takes priority for cdb2026 only).
  await context.route("**://site.api.espn.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));
  if (app.mockEspn) await routeCdb2026Espn(context);

  await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  await page.evaluate(({ storeKey, fixture, seedAdminFnBody }) => {
    localStorage.setItem(storeKey, JSON.stringify(fixture));
    const CFG = window.BR2026_CONFIG || window.CDB2026_CONFIG || window.BOLAO_CONFIG;
    const until = Date.now() + (CFG?.adminSessionMinutes || 30) * 60000;
    const seedAdmin = new Function("until", "return (" + seedAdminFnBody + ")(until)")(until);
    for (const [k, v] of Object.entries(seedAdmin)) sessionStorage.setItem(k, v);
  }, { storeKey: app.storeKey, fixture: app.fixture, seedAdminFnBody: app.seedAdmin.toString() });

  // PR120-final review item 5: BR2026's Jogos comes from a versioned sessionStorage schedule
  // cache (see game_fixtures.mjs) — seeded here, same pass, before the single reload below.
  if (app.seedSchedule) {
    const siteVersion = await page.evaluate(() => window.BR2026_CONFIG?.siteVersion);
    await seedBr2026Schedule(page, siteVersion);
  }

  await page.reload({ waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  // PR120-final review item 3: normalize the three marked buttons' text to the SAME synthetic
  // string in every app, in this ephemeral page only — makes height comparisons meaningful
  // (previously different real i18n label lengths per app made height differences look like a
  // token bug). Runs once; these are static index.html buttons, never re-rendered by section
  // navigation, so the override survives every section click below.
  await page.evaluate((texts) => {
    for (const [id, text] of Object.entries(texts)) {
      const el = document.querySelector(`[data-visual-audit="${id}"]`);
      if (el) el.textContent = text;
    }
  }, SYNTHETIC_BUTTON_TEXT);

  // PR120-final review item 6: `showToast()` is declared inside each app's own top-level IIFE
  // (app.js is "a single IIFE" per CLAUDE.md), so it is NOT reachable as `window.showToast` from
  // here — confirmed this silently no-op'd on a first pass (toast came back N/A in all three
  // apps). Rather than reach into the IIFE, this replicates `showToast()`'s own DOM construction
  // verbatim (confirmed byte-identical in all three apps' app.js: `.bolao-toasts` container +
  // `.bolao-toast <type>` child, plain textContent) — an honest, exact copy of the real markup
  // this component produces, appropriate for a pure CSS-token comparison (this script never
  // exercises app logic, e.g. button-primary/-small/-danger text is already overwritten directly
  // above, the same category of harness-only DOM setup).
  await page.evaluate((text) => {
    let container = document.querySelector(".bolao-toasts");
    if (!container) {
      container = document.createElement("div");
      container.className = "bolao-toasts";
      document.body.appendChild(container);
    }
    const el = document.createElement("div");
    el.className = "bolao-toast info";
    el.textContent = text;
    container.appendChild(el);
  }, TOAST_TRIGGER_TEXT);

  // Visit every section this app's components actually need to be active in (see
  // SECTION_FOR_COMPONENT). Before every click, this ephemeral page's OWN copy of the nav button
  // has both `.hidden` (Copa archived-mode) and `disabled` (BR2026's real entry cutoff passed
  // 2026-07-16 — CLAUDE.md; CDB2026/Copa have the same per-phase-cutoff mechanism) cleared first —
  // real product-state gating that would otherwise silently fail the click (caught, falls through
  // to "whatever section was already active", producing bogus `height:auto`/`0px` readings for
  // form-heading/input-text/select/button-primary that are a harness artifact, not a real style
  // difference). This script's whole purpose (internal design-token comparison, never shown to
  // real users) is explicitly permitted to reach any view this way — applyArchiveMode() and the
  // real cutoff logic in bolao/{app}/js/app.js are themselves never touched.
  const neededSections = [...new Set(Object.values(SECTION_FOR_COMPONENT).filter(Boolean))];
  const stylesBySection = { __always: null };
  for (const section of neededSections) {
    await page.evaluate((ds) => {
      const btn = document.querySelector(`[data-section="${ds}"]`);
      if (btn) { btn.classList.remove("hidden"); btn.disabled = false; }
    }, section);
    await page.locator(`[data-section="${section}"]`).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
    stylesBySection[section] = await readComponentStyles(page, appId);
  }
  // "always visible" components (header/nav chrome, main) — read once, current DOM state is fine
  // (whichever section ended up active last doesn't affect header/nav/main's own computed style).
  stylesBySection.__always = await readComponentStyles(page, appId);

  const result = {};
  for (const comp of COMPONENTS) {
    const section = SECTION_FOR_COMPONENT[comp.id];
    const bucket = section ? stylesBySection[section] : stylesBySection.__always;
    result[comp.id] = bucket ? bucket[comp.id] : null;
  }

  await context.close();
  return result;
}

// Reads getComputedStyle() for every component's selector (resolved for THIS app) against the
// CURRENT DOM state (whatever section happens to be active right now) — the caller is
// responsible for having clicked into the right section first for components that need it (see
// SECTION_FOR_COMPONENT).
async function readComponentStyles(page, appId) {
  const components = COMPONENTS.map(c => ({ id: c.id, selector: c.selectors[appId] || null }));
  return page.evaluate((components) => {
    const out = {};
    for (const comp of components) {
      const sel = comp.selector;
      if (!sel) { out[comp.id] = null; continue; }
      const el = document.querySelector(sel);
      if (!el) { out[comp.id] = null; continue; }
      const cs = getComputedStyle(el);
      out[comp.id] = {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, padding: cs.padding,
        margin: cs.margin, gap: cs.gap, borderRadius: cs.borderRadius,
        backgroundColor: cs.backgroundColor, color: cs.color, height: cs.height,
        minHeight: cs.minHeight, gridTemplateColumns: cs.gridTemplateColumns,
      };
    }
    return out;
  }, components);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Auditoria de Consistência Visual — Estilos Computados (PR120-final review items 3/4/7)");
  lines.push("");
  lines.push(`Gerado em ${report.generatedAtUtc} · commit \`${report.commit}\` · referência visual: **${REFERENCE_APP}** (golden master, ver CLAUDE.md).`);
  lines.push("");
  lines.push("Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em `ALLOWLIST.json`, com fonte/owner/data) · **DIVERGENT** (diferença sem entrada no allowlist — bloqueia exit 0) · **N/A** (componente não existe no app).");
  lines.push("");
  const counts = { EQUAL: 0, EQUIVALENT: 0, JUSTIFIED: 0, DIVERGENT: 0, "N/A": 0 };
  for (const comp of report.components) for (const prop of comp.properties) counts[prop.status]++;
  lines.push("## Resumo");
  lines.push("");
  lines.push("| Status | Quantidade |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(counts)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push("## Divergências não aprovadas (DIVERGENT) — bloqueiam exit 0");
  lines.push("");
  const divergent = [];
  for (const comp of report.components) for (const prop of comp.properties) if (prop.status === "DIVERGENT") divergent.push({ comp, prop });
  if (!divergent.length) {
    lines.push("Nenhuma. Todas as diferenças encontradas são EQUAL, EQUIVALENT ou JUSTIFIED (ver `ALLOWLIST.json`).");
  } else {
    lines.push("| Componente | Propriedade | " + Object.keys(APPS).join(" | ") + " |");
    lines.push("|---|---|" + Object.keys(APPS).map(() => "---").join("|") + "|");
    for (const { comp, prop } of divergent) {
      lines.push(`| ${comp.label} | ${prop.property} | ` + Object.keys(APPS).map(a => "`" + (comp.values[a]?.[prop.property] ?? "N/A") + "`").join(" | ") + " |");
    }
  }
  lines.push("");
  lines.push("## Divergências aprovadas (JUSTIFIED) — ver ALLOWLIST.json");
  lines.push("");
  const justified = [];
  for (const comp of report.components) for (const prop of comp.properties) if (prop.status === "JUSTIFIED") justified.push({ comp, prop });
  if (!justified.length) {
    lines.push("Nenhuma.");
  } else {
    lines.push("| Componente | Propriedade | Justificativa |");
    lines.push("|---|---|---|");
    for (const { comp, prop } of justified) lines.push(`| ${comp.label} | ${prop.property} | ${prop.reason} |`);
  }
  lines.push("");
  lines.push("## Detalhe por componente");
  lines.push("");
  for (const comp of report.components) {
    lines.push(`### ${comp.label} (\`${comp.id}\`)`);
    lines.push("");
    lines.push("Seletores: " + Object.entries(comp.selectors).map(([a, s]) => `${a}=\`${s ?? "N/A"}\``).join(", "));
    if (comp.note) lines.push("");
    if (comp.note) lines.push(`> ${comp.note}`);
    lines.push("");
    lines.push("| Propriedade | " + Object.keys(APPS).join(" | ") + " | Status | Motivo |");
    lines.push("|---|" + Object.keys(APPS).map(() => "---").join("|") + "|---|---|");
    for (const prop of comp.properties) {
      const vals = Object.keys(APPS).map(a => "`" + (comp.values[a]?.[prop.property] ?? "—") + "`").join(" | ");
      lines.push(`| ${prop.property} | ${vals} | ${prop.status} | ${prop.reason || "—"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const chromium = await loadChromium();
  mkdirSync(OUT_DIR, { recursive: true });
  const { map: allowlist, schemaProblems } = loadAllowlist();
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium", headless: true });
  const commit = commitHash();

  const perAppStyles = {};
  try {
    for (const [appId, app] of Object.entries(APPS)) {
      perAppStyles[appId] = await extractStylesForApp(browser, appId, app);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  const components = COMPONENTS.map(comp => {
    const values = {};
    for (const appId of Object.keys(APPS)) values[appId] = perAppStyles[appId][comp.id];
    const properties = PROPERTIES.map(property => {
      const valuesByApp = {};
      for (const appId of Object.keys(APPS)) valuesByApp[appId] = values[appId] ? values[appId][property] : null;
      const { status, reason } = classify(comp.id, property, valuesByApp, allowlist);
      return { property, status, reason: reason || null };
    });
    return { id: comp.id, label: comp.label, selectors: comp.selectors, note: comp.note || null, values, properties };
  });

  const report = { generatedAtUtc: new Date().toISOString(), commit, referenceApp: REFERENCE_APP, apps: Object.keys(APPS), components };

  writeFileSync(join(OUT_DIR, "audit_visual_consistency.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT_DIR, "audit_visual_consistency.md"), buildMarkdown(report));

  const counts = { EQUAL: 0, EQUIVALENT: 0, JUSTIFIED: 0, DIVERGENT: 0, "N/A": 0 };
  for (const comp of components) for (const prop of comp.properties) counts[prop.status]++;
  console.log(`Components compared: ${components.length}`);
  console.log(`Property comparisons: EQUAL=${counts.EQUAL} EQUIVALENT=${counts.EQUIVALENT} JUSTIFIED=${counts.JUSTIFIED} DIVERGENT=${counts.DIVERGENT} N/A=${counts["N/A"]}`);
  console.log(`Output: ${join(OUT_DIR, "audit_visual_consistency.json")}`);
  console.log(`Output: ${join(OUT_DIR, "audit_visual_consistency.md")}`);

  // Hardened per PR120-final review item 3: an allowlist entry that never suppressed a real
  // finding this run is exactly as much a defect as an unapproved DIVERGENT — it means either the
  // underlying issue was already fixed in code (entry should be deleted) or the entry's
  // component/property/apps no longer match reality (entry is stale and needs to be re-pointed).
  // Silently ignoring it would let dead suppressions accumulate forever with nobody noticing.
  const unusedEntries = [...allowlist.entries()]
    .filter(([, entry]) => !entry.used)
    .map(([key, entry]) => `${key} (apps: ${entry.apps.join(",")}, approvedBy: ${entry.approvedBy})`);

  let ok = counts.DIVERGENT === 0;
  if (schemaProblems.length) {
    ok = false;
    console.log(`\n✗ ${schemaProblems.length} problema(s) de schema no ALLOWLIST.json:`);
    for (const p of schemaProblems) console.log(`  ✗ ${p}`);
  }
  if (unusedEntries.length) {
    ok = false;
    console.log(`\n✗ ${unusedEntries.length} entrada(s) de ALLOWLIST.json não utilizada(s) nesta rodada (não suprimiram nenhum achado real — ou já foi corrigido em código, remova a entrada, ou a entrada está desatualizada, corrija component/property/apps):`);
    for (const u of unusedEntries) console.log(`  ✗ ${u}`);
  }
  if (counts.DIVERGENT > 0) {
    console.log(`\n✗ ${counts.DIVERGENT} divergência(s) não aprovada(s) — ver seção "Divergências não aprovadas" em audit_visual_consistency.md.`);
  }
  if (ok) console.log("\n✓ 0 divergência não aprovada, 0 entrada de allowlist inválida/não utilizada.");
  process.exit(ok ? 0 : 1);
}

main();
