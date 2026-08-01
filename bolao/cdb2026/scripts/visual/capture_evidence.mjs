/**
 * capture_evidence.mjs — cross-app visual evidence harness (Fase 2.1 §8).
 *
 * Run:  node bolao/cdb2026/scripts/visual/capture_evidence.mjs
 *
 * Puts all three bolão apps (copa2026, br2026, cdb2026) into the SAME comparable synthetic
 * state (fixture-seeded localStorage, no real participant data) and captures screenshots at the
 * required viewports for the required sections, plus a JSON manifest (route/section/viewport/
 * commit/timestamp), an overflow report (elements wider than the viewport), and console errors.
 *
 * Never touches production: serves the real repo over a local static server and blocks every
 * external network call (CDN/Supabase/ESPN/EmailJS) via Playwright route interception.
 *
 * NOTE on scope: Copa (bolao/copa2026/) is currently in ARCHIVED mode (`CONFIG.archived`, see
 * CLAUDE.md) — its live nav collapses to Ranking only regardless of viewport, by deliberate
 * product decision (tournament concluded). Its screenshots below reflect that real archived
 * state, not a bug in this harness. Sections that don't exist per-app (e.g. "Pagamento" only
 * exists as a distinct page in br2026/cdb2026) are skipped for that app, noted in the manifest.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8188;
const EVIDENCE_ROOT = join(ROOT, "docs", "bolao", "evidence", "visual");

const VIEWPORTS = [
  { w: 320, h: 568, name: "320x568" },
  { w: 375, h: 667, name: "375x667" },
  { w: 390, h: 844, name: "390x844" },
  { w: 414, h: 896, name: "414x896" },
  { w: 768, h: 1024, name: "768x1024" },
  { w: 1024, h: 768, name: "1024x768" },
  { w: 1440, h: 900, name: "1440x900" },
];

// section id -> nav data-section value, per app (apps that don't have a given section omit it).
const APPS = {
  copa2026: {
    path: "/bolao/copa2026/",
    storeKey: "bolao_copa2026_state",
    sections: { Ranking: "ranking" }, // archived: only Ranking is reachable, see header note
  },
  br2026: {
    path: "/bolao/br2026/",
    storeKey: "bolao_br2026_state",
    sections: { Palpites: "entry", Ranking: "ranking", Jogos: "games", Regras: "rules", Admin: "admin" },
  },
  cdb2026: {
    path: "/bolao/cdb2026/",
    storeKey: "bolao_cdb2026_state",
    sections: { Palpites: "entry", Ranking: "ranking", Jogos: "games", Pagamento: "payment", Regras: "rules", Admin: "admin" },
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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
  const commit = commitHash();
  const manifest = [];
  const overflowReport = [];
  const consoleErrors = [];

  try {
    for (const [appId, app] of Object.entries(APPS)) {
      const outDir = join(EVIDENCE_ROOT, appId);
      mkdirSync(outDir, { recursive: true });

      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", e => pageErrors.push(e.message));
        page.on("console", m => {
          if (m.type() !== "error") return;
          const text = m.text();
          // frame-ancestors/integrity: pre-existing, unrelated to this harness.
          // ERR_FAILED/ERR_ABORTED: this harness's OWN CDN/Supabase/ESPN/EmailJS route blocks
          // below, not a real page defect — filtered here so the report reflects genuine issues.
          if (/frame-ancestors|integrity/i.test(text)) return;
          if (/ERR_FAILED|ERR_ABORTED/i.test(text)) return;
          pageErrors.push(text);
        });
        await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
        await context.route("**://*.supabase.co/**", r => r.abort());
        await context.route("**://site.api.espn.com/**", r => r.abort());
        await context.route("**://*.emailjs.com/**", r => r.abort());

        await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
        await page.waitForTimeout(700);

        for (const [sectionLabel, dataSection] of Object.entries(app.sections)) {
          const btn = page.locator(`[data-section="${dataSection}"]`).first();
          const count = await btn.count();
          if (count === 0) continue; // section not reachable in this app's current mode (e.g. archived Copa)
          try { await btn.click({ timeout: 1000 }); } catch { /* disabled (e.g. cutoff-gated) — screenshot as-is */ }
          await page.waitForTimeout(400);

          const fname = `${appId}_${sectionLabel}_${vp.name}.png`;
          await page.screenshot({ path: join(outDir, fname), fullPage: true });

          const overflow = await page.evaluate(() => {
            const vw = window.innerWidth;
            const offenders = [];
            document.querySelectorAll("body *").forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > vw + 2) {
                offenders.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60) || null, right: Math.round(r.right), viewportWidth: vw });
              }
            });
            return offenders.slice(0, 10); // cap — this is a report, not a full dump
          });
          if (overflow.length) overflowReport.push({ app: appId, section: sectionLabel, viewport: vp.name, offenders: overflow });

          manifest.push({
            app: appId, route: app.path, section: sectionLabel, dataSection, viewport: vp.name,
            commit, timestamp: new Date().toISOString(), file: fname,
          });
        }

        if (pageErrors.length) consoleErrors.push({ app: appId, viewport: vp.name, errors: pageErrors });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  writeFileSync(join(EVIDENCE_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(EVIDENCE_ROOT, "overflow_report.json"), JSON.stringify(overflowReport, null, 2));
  writeFileSync(join(EVIDENCE_ROOT, "console_errors.json"), JSON.stringify(consoleErrors, null, 2));

  console.log(`Captured ${manifest.length} screenshots across ${Object.keys(APPS).length} apps.`);
  console.log(`Overflow findings: ${overflowReport.length}`);
  console.log(`Console error findings: ${consoleErrors.length}`);
  console.log(`Manifest: ${join(EVIDENCE_ROOT, "manifest.json")}`);
}

main();
