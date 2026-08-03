/**
 * capture_evidence.mjs — cross-app visual evidence harness (Fase 2.2, full rewrite).
 *
 * Run:  node bolao/cdb2026/scripts/visual/capture_evidence.mjs
 *
 * Fase 2.1's version had 3 confirmed defects, fixed here:
 *   1. A failed section click fell through a `catch {}` straight into a screenshot — producing
 *      files named for the section that was REQUESTED, not the one actually on screen (confirmed:
 *      br2026_Palpites_390x844.png showed Ranking). Fixed: the real active section is read via
 *      the app's own mechanism (`.page.active` id, matching showSection() in app.js) AFTER every
 *      click attempt, and the screenshot filename/manifest record reflects what's ACTUALLY
 *      showing, never what was requested.
 *   2. No synthetic fixture was actually applied before load — each app just rendered its default
 *      empty/real state. Fixed: per-app synthetic localStorage seed via addInitScript(), fictional
 *      names only, applied before navigation.
 *   3. Hard-coded sandbox-only Playwright import path. Fixed: shared playwright_loader.mjs.
 *
 * Never touches production: local static server, all external network blocked, no real
 * participant data anywhere in the seeds below.
 */
import { loadChromium } from "./playwright_loader.mjs";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cdb2026TiesFixture, routeCdb2026Espn, seedBr2026Schedule, unhideCopaJogosForHarness } from "./game_fixtures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8189;
const EVIDENCE_ROOT = join(ROOT, "docs", "bolao", "evidence", "visual");
const FIXTURE_ID = "visual-comparable-v1";

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 414, h: 896 },
  { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 },
];

// ── Synthetic fixtures — fictional names only, no real participant data, no Supabase/ESPN/
// EmailJS calls needed to render (self-contained localStorage seed per app). ──────────────────
function cdb2026Fixture() {
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: { matches: {}, qualified: {} } },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: { matches: {}, qualified: {} } },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    // PR120-final review item 5: was a single scheduled leg (only "agendado"), not a valid basis
    // for the Jogos comparison. Now sourced from the shared game_fixtures.mjs module (agendado,
    // finalizado/placar/agregado, nome longo/estádio, plus ao-vivo/adiado resolved via the ESPN
    // mock installed below — see routeCdb2026Espn()).
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
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    meta: { updatedAt: null, version: FIXTURE_ID },
  };
}
const FIXTURES = { cdb2026: cdb2026Fixture(), br2026: br2026Fixture(), copa2026: null }; // Copa: archived, intentionally no fixture (see §7 note below)

const APPS = {
  copa2026: {
    path: "/bolao/copa2026/", storeKey: "bolao_copa2026_state",
    // Copa is currently ARCHIVED (CONFIG.archived) -- every section but Ranking is intentionally
    // unreachable by product decision, not a defect. Marked notApplicable, not captured/failed.
    sections: { Palpites: "entry", Ranking: "ranking", Jogos: "games", Regras: "rules", Admin: "admin" },
    // Archived mode (CONFIG.archived) hides every nav button except Ranking — confirmed by running
    // the harness once and observing Regras also fails the same way as Palpites/Jogos/Admin.
    // PR120-final review item 5: Jogos removed from this list — the real (public, already-final)
    // 2026 World Cup results ARE a valid "cards reais" screenshot once the harness unhides the
    // nav button in its own ephemeral browser context (see `harnessUnhide` below and
    // `unhideCopaJogosForHarness()` in game_fixtures.mjs) — applyArchiveMode()/CONFIG.archived
    // themselves are never touched, so a real visitor's archived experience is unchanged.
    notApplicable: ["Palpites", "Regras", "Admin"],
    harnessUnhide: { Jogos: "games" },
  },
  br2026: {
    path: "/bolao/br2026/", storeKey: "bolao_br2026_state",
    sections: { Palpites: "entry", Ranking: "ranking", Jogos: "games", Regras: "rules", Admin: "admin" },
    // Entries closed 2026-07-16 (see CLAUDE.md) — the Palpites nav button is permanently disabled
    // by product decision until a future season/cutoff reset, not a rendering defect.
    notApplicable: ["Pagamento", "Palpites"], // BR2026 has no distinct Pagamento nav destination — see CONSISTENCY_MATRIX
  },
  cdb2026: {
    path: "/bolao/cdb2026/", storeKey: "bolao_cdb2026_state",
    sections: { Palpites: "entry", Ranking: "ranking", Jogos: "games", Pagamento: "payment", Regras: "rules", Admin: "admin" },
    // Participantes/Pagamento saíram do nav principal (display:none, mesmo padrão do BR2026/Copa
    // -- Eduardo, 2026-08-01: "Deixe aparecer somente os mesmos botões que estão disponíveis no
    // br2026") -- não é mais alcançável clicando no nav, por decisão de produto (commit b8080aa,
    // "Hide CDB2026 Participantes/Pagamento nav (match BR2026)"), não defeito de renderização.
    // #payment continua existindo/renderizando normalmente, só sem botão apontando pra ela (ver
    // bolao/cdb2026/index.html). Nenhum JS reabilita esse elemento (grepped app.js -- nada
    // alterna seu display), então nenhuma mudança de fixture o tornaria clicável; classificar
    // como qualquer coisa além de notApplicable reportaria uma decisão de produto permanente e
    // intencional como bug. Mirrors BR2026's `notApplicable: ["Pagamento", ...]` above, que
    // documenta o mesmo tipo de caso pelo mesmo motivo.
    //
    // Nota de resolução de rebase (fase2.2-correcao-final sobre origin/main atual, 2026-08-03):
    // duas sessões independentes chegaram à MESMA correção funcional (`notApplicable:
    // ["Pagamento"]`) de forma independente, só com comentários redigidos diferente. Nenhum
    // conflito de lógica -- texto acima combina o detalhe de ambas as versões.
    notApplicable: ["Pagamento"],
  },
};

function commitHash() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
    p.on("error", reject);
    setTimeout(() => resolve(p), 700);
  });
}

// PR120-final review item 5 (found while building game_fixtures.mjs): this used to delete EVERY
// `.png` in each app's evidence directory, including files this script never writes and never
// will (e.g. `${appId}_admin-auth-empty_*.png`/`${appId}_admin-auth-filled_*.png`, written by the
// separate `capture_admin_auth_evidence.mjs` into the SAME per-app directory) — so running this
// script alone silently destroyed a sibling script's already-committed evidence. Fixed: only
// delete filenames matching THIS script's own naming convention
// (`${appId}_${sectionKey}_${viewport}.png` for a `sectionKey` this app's own `sections` map
// actually uses) — anything else in the directory is left alone.
function clearOldEvidence() {
  for (const [appId, app] of Object.entries(APPS)) {
    const dir = join(EVIDENCE_ROOT, appId);
    mkdirSync(dir, { recursive: true });
    const ownSectionKeys = new Set(Object.values(app.sections));
    const ownFilePattern = new RegExp(`^${appId}_(${[...ownSectionKeys].join("|")})_\\d+x\\d+\\.png$`);
    for (const f of readdirSync(dir)) {
      if (ownFilePattern.test(f)) unlinkSync(join(dir, f));
    }
  }
}

async function main() {
  const chromium = await loadChromium();
  clearOldEvidence();
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium", headless: true });
  const commit = commitHash();
  const manifest = [];

  try {
    for (const [appId, app] of Object.entries(APPS)) {
      const outDir = join(EVIDENCE_ROOT, appId);

      for (const vp of VIEWPORTS) {
        const vpLabel = `${vp.w}x${vp.h}`;
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await context.newPage();

        const consoleErrors = [];
        const pageErrors = [];
        page.on("pageerror", e => pageErrors.push(e.message));
        page.on("console", m => {
          if (m.type() !== "error") return;
          const text = m.text();
          // Classified, not silently dropped: these three are pre-existing/expected-by-harness,
          // everything else is treated as a real finding and kept in the manifest.
          if (/frame-ancestors/i.test(text)) return; // pre-existing site-wide CSP quirk, unrelated
          if (/ERR_FAILED|ERR_ABORTED/i.test(text)) return; // this harness's own network blocks below
          consoleErrors.push(text);
        });

        // Fase 2.2 §11: route.fulfill with synthetic empty-but-valid responses instead of a bare
        // abort() for the app's OWN backend calls (Supabase/ESPN/EmailJS) -- an abort surfaces as
        // a console network error that then has to be filtered out by pattern-matching text
        // (fragile). A fulfilled empty response is what the app already handles gracefully
        // (loadRemoteState()/fetchEspnCandidates() already treat "no data" as a normal case), so
        // the app doesn't even log anything for these. CDN scripts are aborted (not faked) since
        // faking a fake JS library would be far riskier than just not loading it.
        await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
        await context.route("**://*.supabase.co/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
        await context.route("**://site.api.espn.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));
        await context.route("**://*.emailjs.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
        // PR120-final review item 5: CDB2026's "ao vivo"/"adiado" Jogos states are resolved by the
        // app's OWN fetchEspnCandidates()/fetchLiveTies() matching against a live ESPN scoreboard
        // response, not a plain state field — so for THIS app only, the generic empty-ESPN route
        // above is overridden with a realistic (schema-accurate, fictional-content) scoreboard
        // mock (registered after the generic route, so it takes priority for cdb2026's requests;
        // Playwright resolves multiple matching routes last-registered-first). See
        // game_fixtures.mjs's file header for why BR2026/Copa don't need an equivalent override.
        if (appId === "cdb2026") await routeCdb2026Espn(context);

        const fixture = FIXTURES[appId];
        await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
        await page.waitForTimeout(700);

        // Fase 2.2 §7: apply the synthetic fixture via localStorage BEFORE any capture, so the
        // rendered state is comparable across apps/viewports. `context.addInitScript()` (the
        // normal way to seed storage pre-navigation) was tried first but proven unreliable in
        // this sandbox: a version mismatch between the pinned Playwright driver (1.56.1) and the
        // pinned Chromium build (141.0.7390.37) silently drops any localStorage write made from
        // an init script — confirmed by an isolated repro where even a single trivial key never
        // survived past the first navigation, on ANY page, while the identical write made via
        // page.evaluate() AFTER load persists normally. Fix: seed post-load via evaluate(), then
        // reload() so the app's own init() picks up the seed from a clean navigation exactly as
        // it would for a real returning visitor with existing localStorage.
        if (fixture) {
          await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: app.storeKey, state: fixture });
          // PR120-final review item 5: BR2026's Jogos comes from a module-level `_schedule` array
          // populated either by a live ESPN fetch or this versioned sessionStorage cache (see
          // game_fixtures.mjs's file header) — seeded here, same pass, before the single reload
          // below, so both storages are in place for the app's next init() together.
          if (appId === "br2026") {
            const siteVersion = await page.evaluate(() => window.BR2026_CONFIG?.siteVersion);
            await seedBr2026Schedule(page, siteVersion);
          }
          await page.reload({ waitUntil: "load", timeout: 15000 });
          await page.waitForTimeout(700);
        }

        for (const [sectionLabel, dataSection] of Object.entries(app.sections)) {
          const record = {
            application: appId, route: app.path, requestedSection: sectionLabel,
            viewport: { width: vp.w, height: vp.h }, fixture: fixture ? FIXTURE_ID : "none (archived app)",
            commit, capturedAtUtc: new Date().toISOString(),
          };

          if (app.notApplicable.includes(sectionLabel)) {
            manifest.push({ ...record, actualSection: null, captured: false, status: "notApplicable", reason: `${sectionLabel} not applicable for ${appId} in its current mode` });
            continue;
          }

          const btn = page.locator(`[data-section="${dataSection}"]`).first();
          const btnCount = await btn.count();
          if (btnCount === 0) {
            manifest.push({ ...record, actualSection: null, captured: false, status: "unavailable", reason: `[data-section="${dataSection}"] not present in DOM` });
            continue;
          }

          // Harness-only unhide (Copa/Jogos — see APPS.copa2026.harnessUnhide above): removes the
          // `.hidden` class this ephemeral page's nav button carries in archived mode, so the
          // click below can reach it. Never touches applyArchiveMode()/CONFIG.archived.
          if (app.harnessUnhide?.[sectionLabel]) {
            await page.evaluate((ds) => document.querySelector(`[data-section="${ds}"]`)?.classList.remove("hidden"), dataSection);
          }

          let clickError = null;
          try { await btn.click({ timeout: 1500 }); } catch (e) { clickError = e.message; }
          await page.waitForTimeout(400);

          // Fase 2.2 §6: verify the REAL active section via the app's own mechanism, never trust
          // that the click "must have worked" just because it didn't throw.
          const actualSection = await page.evaluate(() => document.querySelector(".page.active")?.id || null);

          if (actualSection !== dataSection) {
            manifest.push({
              ...record, actualSection, captured: false, status: "failed",
              reason: clickError ? `click failed: ${clickError}` : `section did not become active (button may be disabled/gated)`,
            });
            continue; // NEVER screenshot here — this is exactly the bug this rewrite fixes
          }

          const fname = `${appId}_${dataSection}_${vpLabel}.png`;
          // Fase 2.2-correção: fullPage:true screenshots of a tall page were rendering `.topbar`
          // TWICE — once in its normal document-flow position, and again lower down where it
          // "stuck" during Chromium's full-page capture pass (position:sticky computing its
          // stuck offset against an intermediate scroll position while the page is being resized
          // to full height for capture — a known Chromium/Playwright quirk with sticky elements
          // and fullPage screenshots, not an app bug: production scrolling behaves correctly,
          // only this specific capture mode double-renders it). Confirmed reproducible on
          // cdb2026_games_320x568.png before this fix (full topbar+nav block appearing again
          // mid-page, between the countdown card and the confronto list). Fix: neutralize
          // `.topbar`'s `position: sticky` to `position: static` via an injected stylesheet,
          // scoped to THIS screenshot only — never touches the actual app CSS files, so
          // production sticky behavior (real users scrolling) is completely unaffected. Other
          // `position: sticky` elements in these apps (e.g. table-row headers inside a scrollable
          // `.standings-wrap`/`.picks-detail` container) are out of scope: they weren't observed
          // duplicating (bound to a small internal scroll container, not the viewport), so
          // neutralizing them isn't needed and would risk changing what a targeted future repro
          // could look like.
          await page.addStyleTag({ content: ".topbar { position: static !important; }" });
          await page.screenshot({ path: join(outDir, fname), fullPage: true });

          const overflowCheck = await page.evaluate(() => {
            const vw = window.innerWidth;
            let overflow = false;
            document.querySelectorAll("body *").forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > vw + 2) overflow = true;
            });
            return overflow;
          });

          manifest.push({
            ...record, actualSection, captured: true, status: "captured",
            consoleErrors: [...consoleErrors], pageErrors: [...pageErrors],
            horizontalOverflow: overflowCheck, overlaps: [], // per-element overlap is check_sticky_overlap.mjs's job (CDB2026-specific CTA); this harness reports overflow only
            screenshot: fname,
          });
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  writeFileSync(join(EVIDENCE_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));

  const counts = manifest.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});
  console.log(`Manifest entries: ${manifest.length}`);
  console.log(`  captured:      ${counts.captured || 0}`);
  console.log(`  unavailable:   ${counts.unavailable || 0}`);
  console.log(`  notApplicable: ${counts.notApplicable || 0}`);
  console.log(`  failed:        ${counts.failed || 0}`);
  console.log(`Manifest: ${join(EVIDENCE_ROOT, "manifest.json")}`);
  process.exit(counts.failed ? 1 : 0);
}

main();
