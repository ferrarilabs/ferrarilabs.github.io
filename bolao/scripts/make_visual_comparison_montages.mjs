/**
 * make_visual_comparison_montages.mjs — Copa | BR2026 | CDB2026 side-by-side montages
 * (Fase 2.2-correção item 9 / coordinator #6).
 *
 * Run:  node bolao/scripts/make_visual_comparison_montages.mjs
 *
 * Pure composition, NOT a new capture — reuses the screenshots already produced by
 * `capture_evidence.mjs` and `capture_admin_auth_evidence.mjs` in `docs/bolao/evidence/visual/`.
 * This machine has no ImageMagick/PIL (`convert`, `magick`, and Python's `PIL` were all checked
 * and are unavailable), so compositing is done the way every other tool in this folder already
 * works: render a small self-contained HTML page (three `<img>` columns + labels) with the
 * already-installed Playwright/Chromium, and screenshot THAT page. No new dependency, no image
 * library, no production code touched.
 *
 * 7 screens x 4 viewports = 28 montages, saved to
 * docs/bolao/evidence/visual-comparison/montage_<screen>_<viewport>.png.
 *
 * Viewports: the 4 Eduardo asked for in this correction round (320x568, 390x844, 768x1024,
 * 1440x900) — not the full 7-viewport set `capture_evidence.mjs` uses for its own manifest.
 *
 * Missing screenshots (Copa's Palpites/Jogos/Regras/Admin — archived, notApplicable; BR2026's
 * Palpites — entries closed) are rendered as a labeled "N/A" placeholder with the real reason,
 * never a blank gap or a silently-skipped column — a reviewer scanning the montage should never
 * have to guess why one third of it is empty.
 */
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { launchChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EVIDENCE_VISUAL = join(ROOT, "docs", "bolao", "evidence", "visual");
const OUT_DIR = join(ROOT, "docs", "bolao", "evidence", "visual-comparison");
// Same fixture identity capture_evidence.mjs/capture_admin_auth_evidence.mjs stamp on the
// screenshots this script only composites (never re-captures) — kept as one literal string
// across all three files rather than importing it, since none of them share a common module today
// and duplicating one string is lower-risk than adding a new cross-file dependency for this.
const FIXTURE_VERSION = "visual-comparable-v1";

function commitHashFull() {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}
function sourceTreeHash() {
  try { return execSync("git rev-parse HEAD^{tree}", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

const VIEWPORTS = [{ w: 320, h: 568 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }];
const APP_LABELS = { copa2026: "Copa do Mundo 2026", br2026: "Brasileirão 2026", cdb2026: "Copa do Brasil 2026" };

// screen id -> { label, fileTag (matches capture_evidence.mjs's `${app}_${dataSection}_${vp}.png`
// naming, or capture_admin_auth_evidence.mjs's `${app}_admin-auth-filled_${vp}.png`), crop:
// "top" (just the topbar+nav strip, for the "tabs" comparison) or "full" (whole page).
const SCREENS = [
  { id: "tabs", label: "Tabs (nav)", fileTag: "ranking", crop: "top" }, // ranking exists for all 3 apps at every viewport, incl. archived Copa -- reused just for its topbar+nav, not its ranking content
  { id: "form", label: "Formulário de palpites (Palpites)", fileTag: "entry", crop: "full" },
  { id: "ranking", label: "Ranking", fileTag: "ranking", crop: "full" },
  { id: "games", label: "Jogos", fileTag: "games", crop: "full" },
  { id: "rules", label: "Regras", fileTag: "rules", crop: "full" },
  { id: "admin-login", label: "Admin — login", fileTag: "admin", crop: "full" },
  { id: "admin-auth", label: "Admin — autenticado", fileTag: "admin-auth-filled", crop: "full" },
];

const NOT_APPLICABLE_REASONS = {
  "copa2026:form": "Copa arquivada (CONFIG.archived) — nav de Palpites oculto, decisão de produto (ver CLAUDE.md).",
  // "copa2026:games" removed (PR120-final review, evidence/allowlist round): Jogos IS captured
  // for Copa now — capture_evidence.mjs's harnessUnhide clears the archived nav's .hidden class
  // in this harness's own ephemeral browser context only (CONFIG.archived/applyArchiveMode()
  // themselves untouched), so a real "games" screenshot exists and findScreenshot() below finds
  // it — this reason entry would never be reached, kept-but-stale would misdescribe reality.
  "copa2026:rules": "Copa arquivada — nav de Regras oculto, decisão de produto.",
  "copa2026:admin-login": "Copa arquivada — nav de Admin oculto para visitantes reais; capture_evidence.mjs (evidência voltada a usuário real) não captura esta tela por isso.",
  "copa2026:admin-auth": "Copa arquivada — capture_admin_auth_evidence.mjs marca esta combinação notApplicable pelo mesmo motivo (ver seu CHANGELOG v3.79).",
  "br2026:form": "BR2026: entradas encerradas 2026-07-16 — nav de Palpites permanentemente desabilitado (ver CLAUDE.md/CONSISTENCY_MATRIX.md).",
};

function findScreenshot(appId, fileTag, vpLabel) {
  const path = join(EVIDENCE_VISUAL, appId, `${appId}_${fileTag}_${vpLabel}.png`);
  return existsSync(path) ? path : null;
}

function toDataUri(path) {
  const b64 = readFileSync(path).toString("base64");
  return `data:image/png;base64,${b64}`;
}

function buildHtml({ screen, vpLabel, cells }) {
  const cropHeight = screen.crop === "top" ? 480 : null; // tabs-only crop; "full" columns just show the whole image, scrolled height determined by content
  const columns = cells.map(cell => {
    if (cell.imgDataUri) {
      const imgStyle = cropHeight
        ? `width:100%; display:block;`
        : `width:100%; display:block;`;
      const wrapperStyle = cropHeight
        ? `width:100%; height:${cropHeight}px; overflow:hidden; border:1px solid #333;`
        : `width:100%; border:1px solid #333;`;
      return `<div class="col">
        <div class="col-label">${cell.label}</div>
        <div style="${wrapperStyle}"><img src="${cell.imgDataUri}" style="${imgStyle}"></div>
      </div>`;
    }
    return `<div class="col">
      <div class="col-label">${cell.label}</div>
      <div class="na-box"><strong>N/A</strong><span>${cell.reason || "Screenshot não disponível"}</span></div>
    </div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; background:#0a0a0a; font-family:-apple-system,Arial,sans-serif; }
    .header { color:#fff; padding:14px 18px; font-size:16px; font-weight:700; background:#111; border-bottom:1px solid #333; }
    .row { display:flex; align-items:flex-start; gap:0; }
    .col { flex:1; min-width:0; border-right:1px solid #222; }
    .col:last-child { border-right:none; }
    .col-label { color:#2fe56e; font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; background:#0d1a12; border-bottom:1px solid #1e3a28; }
    img { max-width:100%; }
    .na-box { display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px; color:#888; text-align:center; padding:16px; gap:6px; font-size:12px; }
    .na-box strong { color:#f59e0b; font-size:20px; }
  </style></head><body>
    <div class="header">${screen.label} — viewport ${vpLabel}</div>
    <div class="row">${columns}</div>
  </body></html>`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchChromium();

  const results = [];
  try {
    for (const screen of SCREENS) {
      for (const vp of VIEWPORTS) {
        const vpLabel = `${vp.w}x${vp.h}`;
        const cells = Object.keys(APP_LABELS).map(appId => {
          const path = findScreenshot(appId, screen.fileTag, vpLabel);
          if (path) return { label: APP_LABELS[appId], imgDataUri: toDataUri(path) };
          const reasonKey = `${appId}:${screen.id}`;
          return { label: APP_LABELS[appId], imgDataUri: null, reason: NOT_APPLICABLE_REASONS[reasonKey] || "Screenshot não encontrado (verificar capture_evidence.mjs / capture_admin_auth_evidence.mjs)" };
        });

        const html = buildHtml({ screen, vpLabel, cells });
        // Composition canvas width: 3 columns side by side, each roughly the target viewport's
        // width so images render near-native scale, not squished.
        const canvasWidth = Math.max(900, vp.w * 3 + 40);
        const context = await browser.newContext({ viewport: { width: canvasWidth, height: 1200 } });
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.waitForTimeout(150);
        const outPath = join(OUT_DIR, `montage_${screen.id}_${vpLabel}.png`);
        await page.screenshot({ path: outPath, fullPage: true });
        await context.close();
        results.push({ screen: screen.id, viewport: vpLabel, file: `montage_${screen.id}_${vpLabel}.png`, apps: cells.map((c, i) => ({ app: Object.keys(APP_LABELS)[i], available: !!c.imgDataUri, reason: c.reason || null })) });
      }
    }
  } finally {
    await browser.close();
  }

  const manifestPath = join(OUT_DIR, "montage_manifest.json");
  const { writeFileSync } = await import("node:fs");
  const meta = {
    generatedAtUtc: new Date().toISOString(),
    sourceCommit: commitHashFull(),
    sourceTreeHash: sourceTreeHash(),
    fixtureVersion: FIXTURE_VERSION,
  };
  writeFileSync(manifestPath, JSON.stringify({ meta, entries: results }, null, 2));
  console.log(`Montages generated: ${results.length}`);
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Manifest: ${manifestPath}`);
}

main();
