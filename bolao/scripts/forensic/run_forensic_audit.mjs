/**
 * run_forensic_audit.mjs — forensic visual parity audit (Jogos + Ranking), 2026-08-04.
 *
 * Component-by-component, property-by-property, pixel-by-pixel comparison of copa2026 (golden
 * master), br2026 and cdb2026's Jogos and Ranking tabs, using the data-visual-role markers added
 * in this same review round and the canonical fixture in fixture.mjs. Near-zero tolerance
 * (see TOLERANCES below) -- no "visually close" verdicts, only IDENTICAL / WITHIN_TOLERANCE /
 * FUNCTIONALLY_JUSTIFIED (against FORENSIC-ALLOWLIST.json only) / DIVERGENT / N/A.
 *
 * Outputs (docs/bolao/evidence/forensic-visual/):
 *   computed-style-comparison.json, geometry-comparison.json, pixel-diff-summary.json,
 *   diff-images/*.png, side-by-side-montages/*.png, fixture-definition.json,
 *   forensic-visual-report.html
 *
 * Exit 0 only when: 0 unapproved computed-style divergences, 0 unapproved geometry divergences,
 * 0 pixel-diff failures, 0 N/A on components that exist in all captured apps, 0 console errors.
 */
import { loadChromium } from "../../cdb2026/scripts/visual/playwright_loader.mjs";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GAMES, RANKING, forensicRankingEntries, forensicRankingState, overrideRankingText,
  br2026ForensicSchedule, seedBr2026ForensicSchedule,
  cdb2026ForensicTies, routeCdb2026ForensicEspn,
  installCopaForensicDataOverride,
} from "./fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 8196;
const OUT_DIR = join(ROOT, "docs", "bolao", "evidence", "forensic-visual");
const DIFF_DIR = join(OUT_DIR, "diff-images");
const MONTAGE_DIR = join(OUT_DIR, "side-by-side-montages");
const ALLOWLIST_PATH = join(OUT_DIR, "FORENSIC-ALLOWLIST.json");
const REFERENCE_APP = "copa2026";
const APPS = ["copa2026", "br2026", "cdb2026"];
const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 414, h: 896 },
  { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 },
];
const PRIMARY_VIEWPORT = { w: 1440, h: 900 }; // computed-style/geometry capture viewport

const PROPERTIES = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
  "textTransform", "textAlign", "color", "backgroundColor",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gap", "rowGap", "columnGap",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "boxShadow", "width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight",
  "display", "position", "alignItems", "justifyContent",
  "gridTemplateColumns", "gridTemplateRows", "flexDirection", "flexWrap",
  "overflow", "overflowX", "overflowY", "whiteSpace", "textOverflow", "wordBreak", "overflowWrap",
];

// Roles compared -- games + ranking only, per the audit's explicit scope (Jogos/Ranking flagged
// as the highest-perceived-inconsistency areas). Each role's selector is IDENTICAL across apps
// (the point of data-visual-role) -- unlike the earlier PR120 audit, no per-app selector map.
const ROLES = [
  "games-section-title", "game-card", "game-date", "game-stage", "home-team", "away-team",
  "team-name", "team-logo", "game-score", "game-time", "game-status",
  "ranking-table", "ranking-row", "ranking-position", "ranking-name", "ranking-points", "ranking-detail",
];

// Which ROLES live inside a per-state game-card vs are state-independent (section title, ranking
// chrome). Game roles are captured once per reachable state (pre/live/post/postponed); ranking
// roles are captured once per fixture row (positions 0..5, covers tie/long-name/2-digit/3-digit/
// zero... not literally zero here, lowest is 12, matches the spec's literal table).
const GAME_STATES = ["pre", "live", "post", "postponed"];
const GAME_ROLE_SET = new Set(["game-card", "game-date", "game-stage", "home-team", "away-team", "team-name", "team-logo", "game-score", "game-time", "game-status"]);
const RANKING_ROLE_SET = new Set(["ranking-table", "ranking-row", "ranking-position", "ranking-name", "ranking-points", "ranking-detail"]);

function commitHashFull() {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}
function sourceTreeHash() {
  try { return execSync("git rev-parse HEAD^{tree}", { cwd: ROOT }).toString().trim(); }
  catch { return "unknown"; }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
    p.on("error", reject);
    setTimeout(() => resolve(p), 700);
  });
}

const DISABLE_MOTION_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

const FROZEN_NOW = new Date("2026-08-04T12:00:00.000Z").getTime();
const FREEZE_TIME_SCRIPT = `
(function () {
  var FROZEN = ${FROZEN_NOW};
  var RealDate = Date;
  function FrozenDate(...args) {
    if (args.length === 0) return new RealDate(FROZEN);
    return new RealDate(...args);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = function () { return FROZEN; };
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.parse = RealDate.parse;
  window.Date = FrozenDate;
})();
`;

// ── Per-app navigation + fixture seeding ────────────────────────────────────────────────────────
async function setupPage(browser, appId, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.w, height: viewport.h } });
  const errors = [];
  const page = await context.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[console] ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

  await context.addInitScript(FREEZE_TIME_SCRIPT);
  await context.addStyleTag?.({ content: DISABLE_MOTION_CSS }).catch(() => {}); // no-op if unsupported pre-nav; re-applied below per-page too

  // Aborted (not fulfilled empty) -- fulfilling empty was tried first and made things WORSE: the
  // real <script integrity="sha384-..."> tag then fails Subresource Integrity verification against
  // the empty body, logging a DIFFERENT console error ("blocked" by SRI) instead of a cleaner
  // ERR_FAILED. Both are harness-only artifacts of deliberately not hitting the real CDN (EmailJS/
  // Supabase aren't exercised by a pure visual/style capture -- CLAUDE.md: "App is local-first").
  // Filtered out of the console-error PASS GATE below (see KNOWN_BASELINE_ERRORS in main.mjs)
  // rather than chased further at the network-mock level -- still logged verbatim for transparency.
  await context.route("**://cdn.jsdelivr.net/**", (r) => r.abort());
  await context.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route("**://*.emailjs.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await context.route("**://site.api.espn.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));

  const storeKeys = { copa2026: "bolao_copa_2026_state", br2026: "bolao_br2026_state", cdb2026: "bolao_cdb2026_state" };
  const paths = { copa2026: "/bolao/copa2026/", br2026: "/bolao/br2026/", cdb2026: "/bolao/cdb2026/" };

  if (appId === "cdb2026") await routeCdb2026ForensicEspn(context);
  if (appId === "copa2026") await installCopaForensicDataOverride(context, ROOT);

  await page.goto(`http://localhost:${PORT}${paths[appId]}`, { waitUntil: "load", timeout: 15000 });
  await page.addStyleTag({ content: DISABLE_MOTION_CSS });
  await page.waitForTimeout(400);

  const baseEntries = forensicRankingEntries();
  const basePaid = Object.fromEntries(baseEntries.map((e, i) => [e.id, i % 2 === 0]));

  await page.evaluate(({ storeKey, entries, paid, appId, phases }) => {
    const existing = JSON.parse(localStorage.getItem(storeKey) || "{}");
    const merged = { ...existing, entries, paid };
    if (appId === "cdb2026" && phases) merged.phases = phases;
    localStorage.setItem(storeKey, JSON.stringify(merged));
  }, { storeKey: storeKeys[appId], entries: baseEntries, paid: basePaid, appId, phases: appId === "cdb2026" ? cdb2026ForensicTies() : null });

  if (appId === "br2026") {
    const siteVersion = await page.evaluate(() => window.BR2026_CONFIG?.siteVersion);
    await seedBr2026ForensicSchedule(page, siteVersion);
  }

  await page.reload({ waitUntil: "load", timeout: 15000 });
  await page.addStyleTag({ content: DISABLE_MOTION_CSS });
  await page.waitForTimeout(400);

  // Unhide + click into games (all three: same nav pattern, Copa's archived-mode .hidden cleared
  // in this harness's own ephemeral context only -- see fixture.mjs file header / prior PR120
  // review's identical justification for the same technique).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-section="games"]');
    if (btn) { btn.classList.remove("hidden"); btn.disabled = false; }
  });
  await page.locator('[data-section="games"]').first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);

  return { context, page, errors };
}

async function captureRanking(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-section="ranking"]');
    if (btn) { btn.classList.remove("hidden"); btn.disabled = false; }
  });
  await page.locator('[data-section="ranking"]').first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(400);
  await overrideRankingText(page);
  await page.waitForTimeout(100);
}

// Returns the DOM state string for a game-card's FIRST leg/card in each reachable state, per app.
// Copa: [data-state] on .game-card (pre/post only -- no live/postponed, see fixture.mjs header).
// BR2026: outer .game-card state class is pre/in/post; postponed is an INNER
//   .game-status.postponed with the outer card still classed "pre" -- resolved by walking up from
//   the inner postponed badge to its ancestor .game-card, distinct from the plain "pre" card.
// CDB2026: .leg's OWN class is pre/live/post/postponed directly.
async function findStateElement(page, appId, state) {
  return page.evaluate(({ appId, state }) => {
    function rectOf(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    if (appId === "copa2026") {
      if (state === "live" || state === "postponed") return null; // permanent N/A, see fixture.mjs header
      const el = document.querySelector(`.game-card[data-state="${state === "pre" ? "pre" : "post"}"]`);
      return el && rectOf(el) ? true : null;
    }
    if (appId === "br2026") {
      if (state === "postponed") {
        const badge = document.querySelector(".game-status.postponed");
        const card = badge?.closest(".game-card");
        return card && rectOf(card) ? true : null;
      }
      const cls = state === "live" ? "in" : state;
      const el = document.querySelector(`.game-card.${cls}:not(:has(.game-status.postponed))`) || document.querySelector(`.game-card.${cls}`);
      return el && rectOf(el) ? true : null;
    }
    if (appId === "cdb2026") {
      const cls = state === "live" ? "live" : state;
      const el = document.querySelector(`.leg.${cls}`);
      return el && rectOf(el) ? true : null;
    }
    return null;
  }, { appId, state });
}

// Scopes a role selector to the first element of a given game state's card/leg, per app -- so
// "team-name" for the LIVE card is actually read from the live card, not the first team-name in
// DOM order (which could be a different state's card).
function scopeSelectorForState(appId, state) {
  if (appId === "copa2026") return `.game-card[data-state="${state === "pre" ? "pre" : "post"}"]`;
  if (appId === "br2026") {
    if (state === "postponed") return ".game-status.postponed"; // resolved specially below
    return `.game-card.${state === "live" ? "in" : state}`;
  }
  if (appId === "cdb2026") return `.leg.${state === "live" ? "live" : state}`;
  return null;
}

async function readRoleStyles(page, scopeSelector, roles, resolvePostponedAncestor) {
  return page.evaluate(({ scopeSelector, roles, resolvePostponedAncestor, PROPERTIES }) => {
    let scope = document.querySelector(scopeSelector);
    if (!scope) return {};
    if (resolvePostponedAncestor) scope = scope.closest(".game-card") || scope;
    const out = {};
    for (const role of roles) {
      // closest() first -- covers ancestor roles (CDB2026's "game-card" lives on .confronto-card,
      // an ancestor of the .leg scope), falls back to querySelector() for descendant roles.
      const el = scope.closest(`[data-visual-role="${role}"]`) || scope.querySelector(`[data-visual-role="${role}"]`);
      if (!el) { out[role] = null; continue; }
      const cs = getComputedStyle(el);
      const style = {};
      for (const p of PROPERTIES) style[p] = cs[p];
      const r = el.getBoundingClientRect();
      out[role] = { style, geometry: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left } };
    }
    return out;
  }, { scopeSelector, roles: Array.from(roles), resolvePostponedAncestor: !!resolvePostponedAncestor, PROPERTIES });
}

async function readRankingRoles(page) {
  return page.evaluate(({ PROPERTIES, count }) => {
    const table = document.querySelector('[data-visual-role="ranking-table"]');
    const out = { "ranking-table": null };
    if (table) {
      const cs = getComputedStyle(table);
      const style = {}; for (const p of PROPERTIES) style[p] = cs[p];
      const r = table.getBoundingClientRect();
      out["ranking-table"] = { style, geometry: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left } };
    }
    const rows = document.querySelectorAll('[data-visual-role="ranking-row"]');
    const perRow = [];
    for (let i = 0; i < count; i++) {
      const row = rows[i];
      if (!row) { perRow.push(null); continue; }
      const entry = { row: null, "ranking-position": null, "ranking-name": null, "ranking-points": null };
      for (const [key, sel] of [["row", null], ["ranking-position", '[data-visual-role="ranking-position"]'], ["ranking-name", '[data-visual-role="ranking-name"]'], ["ranking-points", '[data-visual-role="ranking-points"]']]) {
        const el = sel ? row.querySelector(sel) : row;
        if (!el) continue;
        const cs = getComputedStyle(el);
        const style = {}; for (const p of PROPERTIES) style[p] = cs[p];
        const r = el.getBoundingClientRect();
        entry[key] = { style, geometry: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left } };
      }
      perRow.push(entry);
    }
    return { table: out["ranking-table"], rows: perRow };
  }, { PROPERTIES, count: RANKING.length });
}

// ── Isolated component screenshots for pixel-diff ───────────────────────────────────────────────
// Uses an ElementHandle screenshot (not a manual getBoundingClientRect + page-level clip) so
// Playwright scrolls the target into view itself first -- a manual clip silently produces an
// "empty or outside the resulting image" error for anything below the fold at capture time.
async function screenshotRole(page, scopeSelector, role, outPath, resolvePostponedAncestor) {
  const handle = await page.evaluateHandle(({ scopeSelector, role, resolvePostponedAncestor }) => {
    let scope = document.querySelector(scopeSelector);
    if (!scope) return null;
    if (resolvePostponedAncestor) scope = scope.closest(".game-card") || scope;
    // closest() first (covers the scope element itself AND its ancestors -- e.g. CDB2026's
    // "game-card" role lives on .confronto-card, an ANCESTOR of the .leg this scope selector
    // targets, not a descendant), falls back to querySelector() for genuine descendant roles
    // (team-name, game-status, etc., which ARE inside the leg/card scope).
    const el = scope.closest(`[data-visual-role="${role}"]`) || scope.querySelector(`[data-visual-role="${role}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return el;
  }, { scopeSelector, role, resolvePostponedAncestor });
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  try {
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: outPath });
    return true;
  } catch {
    return false;
  } finally {
    await handle.dispose();
  }
}

// ── Canvas-based pixel diff (no external image-diff dependency) ────────────────────────────────
async function pixelDiff(page, refPath, candPath, diffOutPath) {
  if (!existsSync(refPath) || !existsSync(candPath)) return { comparable: false };
  const refB64 = readFileSync(refPath).toString("base64");
  const candB64 = readFileSync(candPath).toString("base64");
  const result = await page.evaluate(async ({ refB64, candB64 }) => {
    function loadImg(b64) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = "data:image/png;base64," + b64;
      });
    }
    const [imgA, imgB] = await Promise.all([loadImg(refB64), loadImg(candB64)]);
    const w = Math.max(imgA.width, imgB.width), h = Math.max(imgA.height, imgB.height);
    const ca = document.createElement("canvas"); ca.width = w; ca.height = h;
    const cb = document.createElement("canvas"); cb.width = w; cb.height = h;
    const cd = document.createElement("canvas"); cd.width = w; cd.height = h;
    const xa = ca.getContext("2d"), xb = cb.getContext("2d"), xd = cd.getContext("2d");
    xa.drawImage(imgA, 0, 0); xb.drawImage(imgB, 0, 0);
    const da = xa.getImageData(0, 0, w, h), db = xb.getImageData(0, 0, w, h);
    const dd = xd.createImageData(w, h);
    let diffPixels = 0;
    const THRESH = 0.01 * 255; // per-channel threshold, matches spec's threshold<=0.01 (normalized 0-1 scale)
    for (let i = 0; i < da.data.length; i += 4) {
      const dr = Math.abs(da.data[i] - db.data[i]);
      const dg = Math.abs(da.data[i + 1] - db.data[i + 1]);
      const dbl = Math.abs(da.data[i + 2] - db.data[i + 2]);
      const diff = dr > THRESH || dg > THRESH || dbl > THRESH;
      if (diff) {
        diffPixels++;
        dd.data[i] = 255; dd.data[i + 1] = 0; dd.data[i + 2] = 0; dd.data[i + 3] = 255;
      } else {
        dd.data[i] = da.data[i]; dd.data[i + 1] = da.data[i + 1]; dd.data[i + 2] = da.data[i + 2]; dd.data[i + 3] = 60;
      }
    }
    xd.putImageData(dd, 0, 0);
    const totalPixels = w * h;
    return { diffPixels, totalPixels, diffDataUrl: cd.toDataURL("image/png"), sameDimensions: imgA.width === imgB.width && imgA.height === imgB.height };
  }, { refB64, candB64 });
  const base64 = result.diffDataUrl.replace(/^data:image\/png;base64,/, "");
  writeFileSync(diffOutPath, Buffer.from(base64, "base64"));
  const ratio = result.totalPixels ? result.diffPixels / result.totalPixels : 1;
  return { comparable: true, diffPixels: result.diffPixels, totalPixels: result.totalPixels, ratio, sameDimensions: result.sameDimensions };
}

export {
  ROOT, PORT, OUT_DIR, DIFF_DIR, MONTAGE_DIR, ALLOWLIST_PATH, REFERENCE_APP, APPS, VIEWPORTS,
  PRIMARY_VIEWPORT, PROPERTIES, ROLES, GAME_STATES, GAME_ROLE_SET, RANKING_ROLE_SET,
  commitHashFull, sourceTreeHash, startServer, setupPage, captureRanking, findStateElement,
  scopeSelectorForState, readRoleStyles, readRankingRoles, screenshotRole, pixelDiff,
};
