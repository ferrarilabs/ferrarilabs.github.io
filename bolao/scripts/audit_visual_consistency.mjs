/**
 * audit_visual_consistency.mjs — cross-app computed-style consistency audit (Fase 2.2-correção
 * item 7 / coordinator #2).
 *
 * Run:  node bolao/scripts/audit_visual_consistency.mjs
 *
 * Deliberately lives at `bolao/scripts/` (NOT under any single app's `scripts/`) — this is
 * cross-app tooling, unlike everything under `bolao/cdb2026/scripts/`, which is CDB2026-owned
 * (even the shared visual-evidence harness there is CDB2026-rooted by convention/history, see
 * `docs/bolao/PLATFORM_GOVERNANCE.md`). Reuses `playwright_loader.mjs` from
 * `bolao/cdb2026/scripts/visual/` rather than duplicating it — that file is already written to
 * be portable/reusable, not app-specific.
 *
 * What this does: loads all three apps with a synthetic data fixture AND a synthetic admin
 * session (same sessionStorage-key technique verified for `capture_admin_auth_evidence.mjs`,
 * real password never used), reads `getComputedStyle()` for ~26 named components covering the
 * areas listed in the Fase 2.2-correção task (topbar, brand, competition selector, language
 * buttons, tabs, active tab, main, card, h2, h3, inputs, selects, buttons, ranking row, game
 * card, status badge, admin toolbar, admin card/row, rules table cell, WhatsApp button,
 * form-grid), and classifies every property-level comparison as:
 *
 *   EQUAL       — identical computed value in every app where the component exists.
 *   EQUIVALENT  — different string but the same rendered effect (e.g. "0px" vs "" for an unset
 *                 shorthand that resolves to the same box) -- used sparingly, see isEquivalent().
 *   JUSTIFIED   — different value, but for a reason already documented in this repo (matched
 *                 against JUSTIFIED_DIVERGENCES below, cited by source). Never auto-approved
 *                 without a written reason attached to the record.
 *   DIVERGENT   — different value, no documented reason found. Flagged for human review, not
 *                 silently accepted.
 *   N/A         — the component doesn't exist in that app's DOM at all (e.g. CDB2026's
 *                 `.confronto-card` has no equivalent selector reused from Copa's `.game-card` --
 *                 struct is intentionally different per CONSISTENCY_MATRIX.md item 72).
 *
 * Copa's archived mode: `capture_evidence.mjs` (screenshot evidence for real users) correctly
 * marks Copa's non-Ranking sections `notApplicable`, because CONFIG.archived hides those nav
 * buttons for real visitors and that screenshot harness is about what a visitor actually sees.
 * THIS script has a different purpose -- internal design-token comparison, not user-facing
 * evidence -- and the original Fase 2.2-correção task explicitly permitted forcing/simulating
 * Palpites/Jogos/Regras/Admin views for Copa "só via funções locais, fixtures e sessionStorage
 * sintético no contexto do harness Playwright" for exactly this kind of comparison. So here (and
 * only here) the Admin nav button's `.hidden` class is removed client-side, in this harness's own
 * browser context, before clicking it -- applyArchiveMode() and every other production file are
 * untouched; nothing here would let a real visitor reach it.
 */
import { loadChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8191; // distinct from capture_evidence.mjs (8189) / capture_admin_auth_evidence.mjs (8190)
const OUT_DIR = join(ROOT, "docs", "bolao", "evidence", "visual-comparison");
const FIXTURE_ID = "visual-comparable-v1";
const REFERENCE_APP = "copa2026"; // golden master per CLAUDE.md / DESIGN_SYSTEM.md

const PROPERTIES = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "padding", "margin", "gap", "borderRadius", "backgroundColor", "color",
  "height", "minHeight", "gridTemplateColumns",
];

// ── Fixtures (fictional data only) ──────────────────────────────────────────────────────────
function cdb2026Fixture() {
  const emptyMatch = () => ({ homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" });
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: { matches: {}, qualified: {} } },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: { matches: {}, qualified: {} } },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    phases: { oitavas: { cutoffAt: null, ties: { "fx-t1": { teamA: "Time A", teamB: "Time B", matches: { first: { ...emptyMatch(), kickoff: "2030-08-01T20:30:00.000Z" }, second: emptyMatch() } } } } },
    espnSync: { activePhaseId: "oitavas" }, auditLog: [], meta: { updatedAt: null, version: FIXTURE_ID },
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
// purpose.
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
  copa2026: { path: "/bolao/copa2026/", storeKey: "bolao_copa2026_state", fixture: copa2026Fixture(), seedAdmin: (until) => ({ adminOk: "true", adminUntil: String(until) }), archivedAdminNeedsUnhide: true },
  br2026: { path: "/bolao/br2026/", storeKey: "bolao_br2026_state", fixture: br2026Fixture(), seedAdmin: (until) => ({ br2026_adminUntil: String(until) }), archivedAdminNeedsUnhide: false },
  cdb2026: { path: "/bolao/cdb2026/", storeKey: "bolao_cdb2026_state", fixture: cdb2026Fixture(), seedAdmin: (until) => ({ cdb2026_adminUntil: String(until) }), archivedAdminNeedsUnhide: false },
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
  { id: "card", label: "Card (.card)", selectors: { copa2026: ".card", br2026: ".card", cdb2026: ".card" } },
  { id: "h2", label: "h2", selectors: { copa2026: "h2", br2026: "h2", cdb2026: "h2" } },
  { id: "h3", label: "h3", selectors: { copa2026: "h3", br2026: "h3", cdb2026: "h3" } },
  { id: "input-text", label: "Input de texto", selectors: { copa2026: "#entryName", br2026: "input[type=text]", cdb2026: "input[type=text]" } },
  // #paymentMethod explicitly in all three (verified: all three index.html files have this exact
  // id) -- NOT a generic `select` tag match, which would pick up `#bolaoSelect` (the competition
  // switcher pill, earlier in the DOM and styled completely differently) instead, silently
  // comparing the wrong element between apps.
  { id: "select", label: "Select", selectors: { copa2026: "#paymentMethod", br2026: "#paymentMethod", cdb2026: "#paymentMethod" } },
  { id: "form-grid", label: "Form grid (.form-grid)", selectors: { copa2026: ".form-grid", br2026: ".form-grid", cdb2026: ".form-grid" } },
  // None of the three apps actually uses type="submit" (all are type="button", handled via JS
  // delegation) -- verified by grepping each index.html. The real id differs per app (#saveEntry
  // in Copa, #saveEntryBtn in BR2026/CDB2026), so the selector lists both explicitly instead of
  // guessing a shared attribute that doesn't exist (which silently produced `null` for two of
  // the three apps before this fix).
  { id: "button-primary", label: "Botão primário", selectors: { copa2026: "#saveEntry", br2026: "#saveEntryBtn", cdb2026: "#saveEntryBtn" } },
  { id: "button-small", label: "Botão small (.small-btn)", selectors: { copa2026: ".small-btn", br2026: ".small-btn", cdb2026: ".small-btn" } },
  { id: "button-danger", label: "Botão danger (.danger)", selectors: { copa2026: ".danger", br2026: ".danger", cdb2026: ".danger" } },
  { id: "ranking-row", label: "Linha de ranking (.rank-row)", selectors: { copa2026: ".rank-row", br2026: ".rank-row", cdb2026: ".rank-row" } },
  { id: "game-card", label: "Card de jogo", selectors: { copa2026: ".game-card", br2026: ".game-card", cdb2026: ".confronto-card" }, note: "CDB2026 uses .confronto-card (ida+volta layout) instead of .game-card by design — CONSISTENCY_MATRIX.md item 72, INTENTIONALLY_DIFFERENT (tournament format, not a shared component)." },
  { id: "status-badge", label: "Badge de status de jogo", selectors: { copa2026: ".status-chip", br2026: ".game-status", cdb2026: ".game-status" }, note: "Class names differ by app (CONSISTENCY_MATRIX.md item 67: '.status-chip' vs '.game-status', kept per-app deliberately to avoid JS renaming risk) — CSS visual treatment is what's compared here, not the selector name." },
  { id: "paid-badge", label: "Badge de pagamento (.paid-badge)", selectors: { copa2026: ".paid-badge", br2026: ".paid-badge", cdb2026: ".paid-badge" } },
  { id: "admin-toolbar", label: "Admin toolbar (.admin-toolbar)", selectors: { copa2026: ".admin-toolbar", br2026: ".admin-toolbar", cdb2026: ".admin-toolbar" } },
  { id: "admin-card-row", label: "Card/linha de entrada no admin", selectors: { copa2026: ".admin-entry", br2026: ".admin-row", cdb2026: ".admin-row" }, note: "Copa renders each admin entry as a full `.card.admin-entry`; BR2026/CDB2026 use a dense `.admin-row` list — CONSISTENCY_MATRIX.md item 78, NEEDS_REVIEW, deliberately not converted (admin-only screen, list can be long) — documented divergence, not an oversight." },
  { id: "rules-table-cell", label: "Célula de tabela de regras (.rules-table td)", selectors: { copa2026: ".rules-table td", br2026: ".rules-table td", cdb2026: ".rules-table td" } },
  { id: "whatsapp-button", label: "Botão WhatsApp (.whatsapp-btn)", selectors: { copa2026: ".whatsapp-btn", br2026: ".whatsapp-btn", cdb2026: ".whatsapp-btn" } },
];

// Differences already documented elsewhere in this repo as intentional — matched by
// `${componentId}:${property}`. Cited so a reviewer can verify the claim, not just trust it.
const JUSTIFIED_DIVERGENCES = {
  "status-badge:color": "CONSISTENCY_MATRIX.md item 62: --red token differs (Copa #ff6b6b already in production vs BR2026/CDB2026 #f87171) — not unified on purpose, would change a color already live in production; requires a deliberate visual-only change, not a patch-minimal fix.",
  "tabs-nav:gridTemplateColumns": "Fase 2.2-correção item 3 (this branch, bolao/{copa2026,br2026,cdb2026}/CHANGELOG.md v4.165/v1.83/v3.78): column TRACK WIDTHS differ because BR2026 has 7 real visible nav buttons (includes 'Tabela', a BR2026-only tournament-specific tab) vs 6 for Copa/CDB2026 — column COUNT now matches each app's own real button count by design (that was the bug fixed in item 3), so unequal track widths across apps is the CORRECT outcome, not a regression.",
};

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

function classify(componentId, property, valuesByApp) {
  const present = Object.entries(valuesByApp).filter(([, v]) => v !== null);
  if (present.length <= 1) return { status: "N/A", reason: "component not present in enough apps to compare" };
  const [firstApp, firstVal] = present[0];
  const allEqual = present.every(([, v]) => v === firstVal);
  if (allEqual) return { status: "EQUAL" };
  const allEquivalent = present.every(([, v]) => isEquivalent(v, firstVal));
  if (allEquivalent) return { status: "EQUIVALENT" };
  const key = `${componentId}:${property}`;
  if (JUSTIFIED_DIVERGENCES[key]) return { status: "JUSTIFIED", reason: JUSTIFIED_DIVERGENCES[key] };
  return { status: "DIVERGENT", reason: null };
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
  await context.route("**://site.api.espn.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));
  await context.route("**://*.emailjs.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

  await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  await page.evaluate(({ storeKey, fixture, seedAdminFnBody }) => {
    localStorage.setItem(storeKey, JSON.stringify(fixture));
    const CFG = window.BR2026_CONFIG || window.CDB2026_CONFIG || window.BOLAO_CONFIG;
    const until = Date.now() + (CFG?.adminSessionMinutes || 30) * 60000;
    const seedAdmin = new Function("until", "return (" + seedAdminFnBody + ")(until)")(until);
    for (const [k, v] of Object.entries(seedAdmin)) sessionStorage.setItem(k, v);
  }, { storeKey: app.storeKey, fixture: app.fixture, seedAdminFnBody: app.seedAdmin.toString() });
  await page.reload({ waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  // renderAll() (verified by reading each app's app.js directly) already renders ranking, rules,
  // games, and the entry form unconditionally on load -- only the ADMIN panel needs an explicit
  // nav click, because every app's own admin render call is gated behind isAdminActive() (and,
  // for Copa specifically, ALSO behind `#adminArea` not having the `.hidden` class -- see file
  // header comment for why that button is unhidden here, harness-context only).
  if (app.archivedAdminNeedsUnhide) {
    await page.evaluate(() => document.querySelector('[data-section="admin"]')?.classList.remove("hidden"));
  }
  await page.locator('[data-section="admin"]').first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(400);

  const result = {};
  for (const comp of COMPONENTS) {
    const selector = comp.selectors[appId];
    if (!selector) { result[comp.id] = null; continue; }
    const styles = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, padding: cs.padding,
        margin: cs.margin, gap: cs.gap, borderRadius: cs.borderRadius,
        backgroundColor: cs.backgroundColor, color: cs.color, height: cs.height,
        minHeight: cs.minHeight, gridTemplateColumns: cs.gridTemplateColumns,
      };
    }, selector);
    result[comp.id] = styles;
  }
  await context.close();
  return result;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Auditoria de Consistência Visual — Estilos Computados (Fase 2.2-correção item 7)");
  lines.push("");
  lines.push(`Gerado em ${report.generatedAtUtc} · commit \`${report.commit}\` · referência visual: **${REFERENCE_APP}** (golden master, ver CLAUDE.md).`);
  lines.push("");
  lines.push("Classificação: **EQUAL** (idêntico) · **EQUIVALENT** (representação diferente, mesmo efeito) · **JUSTIFIED** (diferença documentada em outro lugar do repo, motivo citado) · **DIVERGENT** (diferença sem justificativa registrada — precisa de revisão humana) · **N/A** (componente não existe no app).");
  lines.push("");
  const counts = { EQUAL: 0, EQUIVALENT: 0, JUSTIFIED: 0, DIVERGENT: 0, "N/A": 0 };
  for (const comp of report.components) for (const prop of comp.properties) counts[prop.status]++;
  lines.push("## Resumo");
  lines.push("");
  lines.push("| Status | Quantidade |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(counts)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push("## Notas metodológicas (ler antes de interpretar `height`/`minHeight` como DIVERGENT)");
  lines.push("");
  lines.push("- **`height` em elementos `height:auto`/orientados por conteúdo** (`main`, `.card`, `.topbar`, `.admin-toolbar`, admin-card-row) **varia com a QUANTIDADE de conteúdo renderizado**, não é um token de design fixo — `main`'s computed height (a página inteira) é literalmente proporcional a quanto conteúdo cada app tem carregado no momento da captura (fixtures diferentes, número de fases/jogos diferente), não uma medida de estilo comparável. Presente na tabela porque a tarefa pediu explicitamente para capturar `height`/`minHeight`, mas **não deve ser lido como um problema de design system** a menos que o elemento tenha uma altura fixa por CSS (ex.: `.small-btn`, `.danger`, `select`, `.rank-row` — esses SIM são comparáveis).");
  lines.push("- **`.game-card` no BR2026 não foi capturado** (`null` na tabela) — `renderGamesSection()` do BR2026 só roda quando `_schedule.length > 0`, e esse script bloqueia/simula a API da ESPN com uma resposta vazia (mesma política de rede das outras ferramentas desta pasta — nunca produção real). Resultado: BR2026 não teve nenhum `.game-card` renderizado nesta auditoria, então a comparação com Copa/CDB2026 para esse componente ficou incompleta — não um DIVERGENT real, uma lacuna de fixture. Registrado aqui em vez de escondido.");
  lines.push("- **`.card` compara o PRIMEIRO elemento `.card` no DOM de cada app**, que pode não ser o mesmo card semanticamente (ex.: o primeiro card de um app pode ser o hero/intro, o de outro pode ser um card de countdown com layout de grid próprio) — `gridTemplateColumns`/`backgroundColor`/`gap` divergentes aqui podem refletir estar comparando cards DIFERENTES, não um token de `.card` genuinamente inconsistente. Achado real (dois selectors com IDs verificados, `select`/`button-primary`, já foram corrigidos nesta mesma rodada depois de um problema idêntico ser encontrado — ver commit) mas não corrigido aqui por falta de um seletor comum óbvio entre os três apps para 'o card X especificamente'; recomendo revisão manual antes de tratar como DIVERGENT real.");
  lines.push("");
  lines.push("## Divergências não justificadas (DIVERGENT) — precisam de revisão");
  lines.push("");
  const divergent = [];
  for (const comp of report.components) for (const prop of comp.properties) if (prop.status === "DIVERGENT") divergent.push({ comp, prop });
  if (!divergent.length) {
    lines.push("Nenhuma. Todas as diferenças encontradas são EQUAL, EQUIVALENT ou JUSTIFIED.");
  } else {
    lines.push("| Componente | Propriedade | " + Object.keys(APPS).join(" | ") + " |");
    lines.push("|---|---|" + Object.keys(APPS).map(() => "---").join("|") + "|");
    for (const { comp, prop } of divergent) {
      lines.push(`| ${comp.label} | ${prop.property} | ` + Object.keys(APPS).map(a => "`" + (comp.values[a]?.[prop.property] ?? "N/A") + "`").join(" | ") + " |");
    }
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
      const { status, reason } = classify(comp.id, property, valuesByApp);
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
  process.exit(counts.DIVERGENT > 0 ? 1 : 0);
}

main();
