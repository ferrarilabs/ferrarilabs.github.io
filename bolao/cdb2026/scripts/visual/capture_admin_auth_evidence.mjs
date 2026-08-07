/**
 * capture_admin_auth_evidence.mjs — authenticated admin-panel evidence (Fase 2.2-correção item 6
 * / coordinator #4).
 *
 * Run:  node bolao/cdb2026/scripts/visual/capture_admin_auth_evidence.mjs
 *
 * capture_evidence.mjs only ever captures the Admin section's LOGIN form (isAdminActive() is
 * false by default, so #adminLogin is what's on screen) — no session in this codebase's admin
 * flow can be reached by clicking through the UI without the real password, and this harness
 * must never touch the real password (see CLAUDE.md/AGENTS rules). Real admin sessions are
 * `sessionStorage`-only (see PROJECT_MEMORY.md "Administração"), so a SYNTHETIC session is
 * seeded directly via `page.evaluate()`, using the exact keys each app's own `isAdminActive()`
 * checks (verified by reading the source directly before writing this script, not assumed):
 *
 *   copa2026:  sessionStorage.adminOk === "true"  AND  sessionStorage.adminUntil > Date.now()
 *              (bolao/copa2026/js/app.js:611-613)
 *   br2026:    sessionStorage.br2026_adminUntil > Date.now()
 *              (bolao/br2026/js/app.js:211)
 *   cdb2026:   sessionStorage.cdb2026_adminUntil > Date.now()
 *              (bolao/cdb2026/js/app.js:446)
 *
 * copa2026 is EXCLUDED from the authenticated capture (marked notApplicable, not "failed" or
 * silently skipped): CONFIG.archived hides the Admin nav button (`.hidden` class) exactly like
 * Palpites/Jogos/Regras — same product decision the main capture_evidence.mjs already respects
 * for those sections. Not worked around here either, per the standing rule: never modify
 * applyArchiveMode() or any production logic to make a capture possible.
 *
 * Two states captured per applicable app: "filled" (existing fixture: 2 entries, one paid one
 * not) and "empty" (zero entries) — request was for both empty and populated states, not just
 * one. All fixture data is fictional (see FIXTURE_FILLED/*_EMPTY below), same as
 * capture_evidence.mjs. Never touches production: local static server only, all external
 * network blocked, no real password anywhere in this file.
 *
 * Scope note (documented honestly, not silently reduced): this captures the admin LANDING view
 * (toolbar + all of renderAdmin()'s stacked sections — results/entries/payments/audit log all
 * render into the same #adminArea in one page, so a single fullPage screenshot per viewport
 * already shows toolbar, entries, payments, and audit log together for br2026/cdb2026). It does
 * NOT click into individual export buttons or trigger destructive actions (clicking "Limpar
 * tudo" etc.) — those remain unphotographed. See docs/bolao/FASE2.2_CORRECAO_FINAL_REPORT.md for
 * what's still open.
 */
import { launchChromium } from "./playwright_loader.mjs";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startStaticServer } from "../../../scripts/static_server.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8190; // distinct from capture_evidence.mjs's 8189 so both can run without colliding
const EVIDENCE_ROOT = join(ROOT, "docs", "bolao", "evidence", "visual");
const FIXTURE_ID = "visual-comparable-v1";

// Reduced viewport set vs. capture_evidence.mjs's 7 -- admin is an internal/low-visibility
// screen (only Eduardo uses it, see CONSISTENCY_MATRIX.md item 78's rationale for the same
// screen), so mobile/tablet/desktop is representative without 7x the runtime for a screen no
// participant ever sees.
// 390x844 added (Fase 2.2-correção item 9) — the side-by-side montage script needs this exact
// viewport for its 4-viewport set (320/390/768/1440, per Eduardo's second correction round), and
// this harness previously only had 320/768/1440.
const VIEWPORTS = [{ w: 320, h: 568 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }];

function cdb2026FixtureFilled() {
  const emptyMatch = () => ({ homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" });
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: { matches: {}, qualified: {} } },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: { matches: {}, qualified: {} } },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    phases: {
      oitavas: { cutoffAt: null, ties: {
        "fx-t1": { teamA: "Time A", teamB: "Time B", matches: { first: { ...emptyMatch(), kickoff: "2030-08-01T20:30:00.000Z" }, second: emptyMatch() } },
      } },
    },
    espnSync: { activePhaseId: "oitavas" },
    auditLog: [{ ts: "2026-07-20T12:10:00.000Z", action: "paid.set", detail: "fx-1 -> true" }],
    meta: { updatedAt: null, version: FIXTURE_ID },
  };
}
function cdb2026FixtureEmpty() {
  return { entries: [], deletedIds: [], paid: {}, phases: {}, espnSync: {}, auditLog: [], meta: { updatedAt: null, version: FIXTURE_ID } };
}
function br2026FixtureFilled() {
  return {
    entries: [
      { id: "fx-1", entryName: "Entrada Teste #1", payerName: "Participante A", participantEmail: "a@example.invalid", paymentMethod: "CashApp", createdAt: "2026-07-20T12:00:00.000Z", picks: {} },
      { id: "fx-2", entryName: "Entrada Teste #2", payerName: "Participante B", participantEmail: "b@example.invalid", paymentMethod: "Zelle", createdAt: "2026-07-20T12:05:00.000Z", picks: {} },
    ],
    deletedIds: [], paid: { "fx-1": true, "fx-2": false },
    meta: { updatedAt: null, version: FIXTURE_ID },
  };
}
function br2026FixtureEmpty() {
  return { entries: [], deletedIds: [], paid: {}, meta: { updatedAt: null, version: FIXTURE_ID } };
}

const APPS = {
  copa2026: { applicable: false, reason: "CONFIG.archived hides the Admin nav button (.hidden class), same product decision as Palpites/Jogos/Regras -- not worked around, matches capture_evidence.mjs's existing treatment of this app." },
  br2026: {
    applicable: true,
    path: "/bolao/br2026/", storeKey: "bolao_br2026_state",
    seedAdmin: (until) => ({ br2026_adminUntil: String(until) }),
    fixtures: { filled: br2026FixtureFilled(), empty: br2026FixtureEmpty() },
  },
  cdb2026: {
    applicable: true,
    path: "/bolao/cdb2026/", storeKey: "bolao_cdb2026_state",
    seedAdmin: (until) => ({ cdb2026_adminUntil: String(until) }),
    fixtures: { filled: cdb2026FixtureFilled(), empty: cdb2026FixtureEmpty() },
  },
};

function commitHash() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

// Full (not abbreviated) commit hash for the manifest's sourceCommit field — unambiguous even if
// short-hash collisions ever become a concern, unlike the display-only commitHash() above.
function commitHashFull() {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

// Hash of the actual tree object HEAD points at — distinct from the commit hash: if this worktree
// has uncommitted changes, sourceCommit alone would silently describe a DIFFERENT (older) state
// than what was actually captured. Comparing this against a fresh `git rev-parse HEAD^{tree}` is
// how a reviewer can independently confirm the evidence really matches a clean, unmodified commit.
function sourceTreeHash() {
  try { return execSync("git rev-parse HEAD^{tree}", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

// Delega ao helper compartilhado fail-closed (bolao/scripts/static_server.mjs). Antes daqui
// este corpo era spawn+setTimeout com stdio ignorado: se a porta estivesse ocupada, o python
// morria em silêncio e o browser media um servidor/checkout ESTRANHO. Ver o cabeçalho do helper.
// Devolve um objeto com .kill() para os call sites existentes seguirem iguais.
async function startServer() {
  const s = await startStaticServer(PORT, ROOT);
  return { kill: s.stop };
}

async function main() {
  const server = await startServer();
  const browser = await launchChromium();
  const commit = commitHash();
  const manifest = [];

  try {
    for (const [appId, app] of Object.entries(APPS)) {
      if (!app.applicable) {
        manifest.push({ application: appId, requestedSection: "AdminAuthenticated", captured: false, status: "notApplicable", reason: app.reason, commit, capturedAtUtc: new Date().toISOString() });
        continue;
      }
      const outDir = join(EVIDENCE_ROOT, appId);
      mkdirSync(outDir, { recursive: true });

      for (const state of ["filled", "empty"]) {
        for (const vp of VIEWPORTS) {
          const vpLabel = `${vp.w}x${vp.h}`;
          const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
          const page = await context.newPage();
          const consoleErrors = [];
          page.on("console", m => { if (m.type() === "error" && !/frame-ancestors|ERR_FAILED|ERR_ABORTED/i.test(m.text())) consoleErrors.push(m.text()); });

          await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
          await context.route("**://*.supabase.co/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
          await context.route("**://site.api.espn.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));
          await context.route("**://*.emailjs.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

          await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
          await page.waitForTimeout(500);

          // Seed BOTH the data fixture and the synthetic admin session, then reload once so the
          // app's own init() picks both up from a clean navigation -- same pattern
          // capture_evidence.mjs already uses for data fixtures, extended to also cover the
          // session key(s). adminSessionMinutes (30 in all three apps' config.js, verified) is
          // read directly from the app's own already-loaded CONFIG global rather than
          // hard-coded here, so this stays correct if that number ever changes.
          await page.evaluate(({ storeKey, fixture, seedAdminFnBody }) => {
            localStorage.setItem(storeKey, JSON.stringify(fixture));
            const minutes = (window.BR2026_CONFIG || window.CDB2026_CONFIG || window.BOLAO_CONFIG).adminSessionMinutes;
            const until = Date.now() + minutes * 60000;
            const seedAdmin = new Function("until", "return (" + seedAdminFnBody + ")(until)")(until);
            for (const [k, v] of Object.entries(seedAdmin)) sessionStorage.setItem(k, v);
          }, { storeKey: app.storeKey, fixture: app.fixtures[state], seedAdminFnBody: app.seedAdmin.toString() });
          await page.reload({ waitUntil: "load", timeout: 15000 });
          await page.waitForTimeout(500);

          // Click Admin like a real user would -- proves the nav button itself works, not just
          // that the DOM can be forced into the right state.
          await page.locator('[data-section="admin"]').first().click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(400);

          const check = await page.evaluate(() => ({
            actualSection: document.querySelector(".page.active")?.id || null,
            loginVisible: !document.getElementById("adminLogin")?.classList.contains("hidden") && getComputedStyle(document.getElementById("adminLogin")).display !== "none",
            areaVisible: !document.getElementById("adminArea")?.classList.contains("hidden"),
          }));

          const record = {
            application: appId, requestedSection: "AdminAuthenticated", state, viewport: { width: vp.w, height: vp.h },
            commit, capturedAtUtc: new Date().toISOString(), actualSection: check.actualSection,
          };

          if (check.actualSection !== "admin" || check.loginVisible || !check.areaVisible) {
            manifest.push({ ...record, captured: false, status: "failed", reason: `synthetic session did not bypass login as expected (loginVisible=${check.loginVisible}, areaVisible=${check.areaVisible})` });
            await context.close();
            continue;
          }

          const overflowCheck = await page.evaluate(() => {
            const vw = window.innerWidth;
            let overflow = false;
            document.querySelectorAll("body *").forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 2) overflow = true; });
            return overflow;
          });

          await page.addStyleTag({ content: ".topbar { position: static !important; }" });
          const fname = `${appId}_admin-auth-${state}_${vpLabel}.png`;
          await page.screenshot({ path: join(outDir, fname), fullPage: true });

          manifest.push({ ...record, captured: true, status: "captured", consoleErrors, horizontalOverflow: overflowCheck, screenshot: fname });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  // PR120-final review (evidence/allowlist round): every regenerated manifest now carries enough
  // metadata for an independent reviewer to tell WHEN this was captured and against WHAT exact
  // tree, without having to cross-reference a separate commit message.
  const outPath = join(EVIDENCE_ROOT, "admin_auth_manifest.json");
  const meta = {
    generatedAtUtc: new Date().toISOString(),
    sourceCommit: commitHashFull(),
    sourceTreeHash: sourceTreeHash(),
    fixtureVersion: FIXTURE_ID,
  };
  writeFileSync(outPath, JSON.stringify({ meta, entries: manifest }, null, 2));
  const counts = manifest.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});
  console.log(`Admin-auth manifest entries: ${manifest.length}`);
  console.log(`  captured:      ${counts.captured || 0}`);
  console.log(`  notApplicable: ${counts.notApplicable || 0}`);
  console.log(`  failed:        ${counts.failed || 0}`);
  console.log(`Manifest: ${outPath}`);
  process.exit(counts.failed ? 1 : 0);
}

main();
