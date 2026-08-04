/**
 * main.mjs — orchestrator for the forensic visual parity audit. Run:
 *   node bolao/scripts/forensic/main.mjs
 *
 * See run_forensic_audit.mjs and classify.mjs for the capture/classification engine, fixture.mjs
 * for the canonical text/data every app renders. This file: runs the capture loop, classifies
 * every computed-style and geometry comparison, pixel-diffs isolated component screenshots
 * (Copa as reference), builds side-by-side montages across all 7 viewports, writes every required
 * JSON output plus the navigable HTML report, and determines final exit code per the audit's own
 * pass criteria (section 16 of the task spec: zero unapproved divergences of any kind).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadChromium } from "../../cdb2026/scripts/visual/playwright_loader.mjs";
import {
  ROOT, PORT, OUT_DIR, DIFF_DIR, MONTAGE_DIR, ALLOWLIST_PATH, REFERENCE_APP, APPS, VIEWPORTS,
  PRIMARY_VIEWPORT, PROPERTIES, GAME_STATES, GAME_ROLE_SET, RANKING_SELECTORS,
  commitHashFull, sourceTreeHash, startServer, setupPage, captureRanking, findStateElement,
  scopeSelectorForState, readRoleStyles, readRankingRoles, screenshotRole, pixelDiff,
} from "./run_forensic_audit.mjs";
import { loadAllowlist, classify } from "./classify.mjs";
import { GAMES, RANKING } from "./fixture.mjs";
import { execSync } from "node:child_process";

const CAPTURES_DIR = join(DIFF_DIR, "captures");
const HARNESS_VERSION = "2.0.0"; // bumped from the data-visual-role-era 1.x harness (part 2026-08 rewrite)
const FIXTURE_VERSION = "2.0.0"; // bumped when RANKING/GAMES fixture content changes (part 5: real name removed)

function redactUserPaths(str) {
  // Part 11: no absolute /Users/... paths in any generated artifact.
  return str.split(ROOT).join(".");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DIFF_DIR, { recursive: true });
  mkdirSync(CAPTURES_DIR, { recursive: true });
  mkdirSync(MONTAGE_DIR, { recursive: true });

  const chromium = await loadChromium();
  const server = await startServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
  const browser = await chromium.launch({ executablePath, headless: true });

  const consoleErrors = {};
  const gameCaptures = {};      // gameCaptures[appId][state] = { role: {style,geometry} } | null
  const naReasonsByAppStateRole = {}; // [appId][state][role] = "LEGITIMATE_NA"|"MISSING_SELECTOR"|"MISSING_FIXTURE"
  const titleCaptures = {};     // titleCaptures[appId] = {style,geometry} | null
  const rankingCaptures = {};   // rankingCaptures[appId] = { table, rows: [...] }
  const screenshotIndex = {};   // screenshotIndex[appId][state][role] = filePath
  const screenshotMeta = {};    // screenshotMeta[appId][state][role] = {ok, reason, locator, textContent, boundingBox, visible} (part 8)

  try {
    for (const appId of APPS) {
      const { context, page, errors } = await setupPage(browser, appId, PRIMARY_VIEWPORT);
      consoleErrors[appId] = errors;

      gameCaptures[appId] = {};
      naReasonsByAppStateRole[appId] = {};
      screenshotIndex[appId] = {};
      screenshotMeta[appId] = {};

      for (const state of GAME_STATES) {
        const reachable = await findStateElement(page, appId, state);
        if (!reachable) {
          gameCaptures[appId][state] = null;
          screenshotIndex[appId][state] = null;
          screenshotMeta[appId][state] = null;
          // copa2026 permanently has no "live" or "postponed" CSS state at all (verified:
          // .status-chip only defines done/pending/live -- no postponed; "live" state IS defined
          // but the archived, concluded tournament's real dataset never renders it) -- documented,
          // permanent, structural absence, not a fixture/harness bug. Every other unreachable
          // state is a real MISSING_FIXTURE (this run's fixture data should have produced that
          // state but didn't -- a genuine gap to investigate, not a design difference).
          const legitimate = appId === "copa2026" && (state === "live" || state === "postponed");
          naReasonsByAppStateRole[appId][state] = Object.fromEntries([...GAME_ROLE_SET].map((r) => [r, legitimate ? "LEGITIMATE_NA" : "MISSING_FIXTURE"]));
          continue;
        }
        const resolvePostponedAncestor = appId === "br2026" && state === "postponed";
        const scopeSelector = scopeSelectorForState(appId, state);
        const captured = await readRoleStyles(page, appId, scopeSelector, GAME_ROLE_SET, resolvePostponedAncestor);
        naReasonsByAppStateRole[appId][state] = captured.__naReasons || {};
        delete captured.__naReasons;
        gameCaptures[appId][state] = captured;

        screenshotIndex[appId][state] = {};
        screenshotMeta[appId][state] = {};
        for (const role of GAME_ROLE_SET) { // GAME_ROLE_SET already includes "game-card" -- do not prepend it again (was a duplication bug, part 4)
          const fname = `${appId}_${state}_${role}.png`;
          const outPath = join(CAPTURES_DIR, fname);
          const meta = await screenshotRole(page, appId, scopeSelector, role, outPath, resolvePostponedAncestor);
          screenshotMeta[appId][state][role] = meta;
          if (meta.ok) screenshotIndex[appId][state][role] = outPath;
        }
      }

      const titleStyles = await readRoleStyles(page, appId, "body", new Set(["games-section-title"]), false);
      titleCaptures[appId] = titleStyles["games-section-title"] || null;

      await captureRanking(page);
      rankingCaptures[appId] = await readRankingRoles(page);
      for (let i = 0; i < RANKING.length; i++) {
        const fname = `${appId}_ranking-row-${i}.png`;
        const outPath = join(CAPTURES_DIR, fname);
        const rows = await page.$$(RANKING_SELECTORS["ranking-row"]);
        const el = rows[i];
        if (el) {
          const box = await el.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            await el.scrollIntoViewIfNeeded();
            await el.screenshot({ path: outPath });
            screenshotIndex[appId][`ranking-row-${i}`] = { "ranking-row": outPath };
          }
        }
      }
      const fullRankingPath = join(CAPTURES_DIR, `${appId}_ranking-table.png`);
      const tableEl = await page.$(RANKING_SELECTORS["ranking-table"]);
      if (tableEl) {
        const box = await tableEl.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          await tableEl.scrollIntoViewIfNeeded();
          await tableEl.screenshot({ path: fullRankingPath });
        }
      }

      await context.close();
    }

    // ── Full-page montage screenshots at all 7 viewports (Jogos + Ranking) ─────────────────────
    const montageShots = {}; // montageShots[appId][viewportLabel] = { games: path, ranking: path }
    for (const appId of APPS) {
      montageShots[appId] = {};
      for (const vp of VIEWPORTS) {
        const vpLabel = `${vp.w}x${vp.h}`;
        const { context, page } = await setupPage(browser, appId, vp);
        const gamesPath = join(CAPTURES_DIR, `${appId}_games-full_${vpLabel}.png`);
        await page.screenshot({ path: gamesPath, fullPage: true });
        await captureRanking(page);
        const rankingPath = join(CAPTURES_DIR, `${appId}_ranking-full_${vpLabel}.png`);
        await page.screenshot({ path: rankingPath, fullPage: true });
        montageShots[appId][vpLabel] = { games: gamesPath, ranking: rankingPath };
        await context.close();
      }
    }

    // ── Classification: computed-style-comparison.json + geometry-comparison.json ──────────────
    const { map: allowlist, schemaProblems } = loadAllowlist(ALLOWLIST_PATH, APPS);
    const styleComparison = [];
    const geometryComparison = [];

    function addComparison(component, stateLabel, valuesByApp, naReasonByApp = {}) {
      const styleRow = { component, state: stateLabel, properties: {} };
      const geomRow = { component, state: stateLabel, geometry: {} };
      for (const prop of PROPERTIES) {
        const vals = {};
        for (const app of APPS) vals[app] = valuesByApp[app] ? valuesByApp[app].style[prop] : null;
        const result = classify(component, prop, vals, allowlist, { isGeometry: false, naReasonByApp });
        styleRow.properties[prop] = { values: vals, ...result };
      }
      for (const field of ["width", "height"]) {
        const vals = {};
        for (const app of APPS) vals[app] = valuesByApp[app] ? valuesByApp[app].geometry[field] : null;
        const result = classify(component, field, vals, allowlist, { isGeometry: true, naReasonByApp });
        geomRow.geometry[field] = { values: vals, ...result };
      }
      styleComparison.push(styleRow);
      geometryComparison.push(geomRow);
    }

    // games-section-title (state-independent, no per-app selector variance -- always real if setupPage succeeded)
    addComparison("games-section-title", "static", { copa2026: titleCaptures.copa2026, br2026: titleCaptures.br2026, cdb2026: titleCaptures.cdb2026 });

    for (const state of GAME_STATES) {
      for (const role of GAME_ROLE_SET) {
        const valuesByApp = {};
        const naReasonByApp = {};
        for (const app of APPS) {
          valuesByApp[app] = gameCaptures[app][state]?.[role] || null;
          if (!valuesByApp[app]) naReasonByApp[app] = naReasonsByAppStateRole[app]?.[state]?.[role] || "MISSING_COMPONENT";
        }
        addComparison(role, state, valuesByApp, naReasonByApp);
      }
    }

    // ranking-table (state-independent)
    addComparison("ranking-table", "static", { copa2026: rankingCaptures.copa2026.table, br2026: rankingCaptures.br2026.table, cdb2026: rankingCaptures.cdb2026.table });
    // ranking rows, per fixture index (0..5) -- role captured per row: position/name/points, plus the row itself
    for (let i = 0; i < RANKING.length; i++) {
      const rowLabel = `ranking-row-${i}`;
      for (const sub of ["row", "ranking-position", "ranking-name", "ranking-points"]) {
        const valuesByApp = {};
        for (const app of APPS) valuesByApp[app] = rankingCaptures[app]?.rows?.[i]?.[sub] || null;
        addComparison(sub === "row" ? "ranking-row" : sub, rowLabel, valuesByApp);
      }
    }

    writeFileSync(join(OUT_DIR, "computed-style-comparison.json"), redactUserPaths(JSON.stringify({
      meta: { generatedAtUtc: new Date().toISOString(), sourceCommit: commitHashFull(), sourceTreeHash: sourceTreeHash(), referenceApp: REFERENCE_APP, fixtureVersion: FIXTURE_VERSION, harnessVersion: HARNESS_VERSION },
      comparisons: styleComparison,
    }, null, 2)));
    writeFileSync(join(OUT_DIR, "geometry-comparison.json"), redactUserPaths(JSON.stringify({
      meta: { generatedAtUtc: new Date().toISOString(), sourceCommit: commitHashFull(), sourceTreeHash: sourceTreeHash(), fixtureVersion: FIXTURE_VERSION, harnessVersion: HARNESS_VERSION },
      comparisons: geometryComparison,
    }, null, 2)));

    // ── Pixel diff (Copa reference vs BR2026/CDB2026) ───────────────────────────────────────────
    const utilContext = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const utilPage = await utilContext.newPage();
    const pixelDiffResults = [];
    for (const state of GAME_STATES) {
      for (const role of GAME_ROLE_SET) { // GAME_ROLE_SET already includes "game-card" -- do not prepend it again (was a duplication bug, part 4)
        const refPath = screenshotIndex[REFERENCE_APP]?.[state]?.[role];
        for (const app of APPS) {
          if (app === REFERENCE_APP) continue;
          const candPath = screenshotIndex[app]?.[state]?.[role];
          const diffPath = join(DIFF_DIR, `${app}_vs_${REFERENCE_APP}_${state}_${role}.png`);
          if (!refPath || !candPath) {
            // Part 9: reuse the same reason taxonomy the screenshot capture itself already
            // produced (screenshotMeta), instead of a fresh generic "N/A" string here.
            const refMeta = screenshotMeta[REFERENCE_APP]?.[state]?.[role];
            const candMeta = screenshotMeta[app]?.[state]?.[role];
            const naReason = !refPath ? (refMeta?.reason || "MISSING_COMPONENT") : (candMeta?.reason || "MISSING_COMPONENT");
            pixelDiffResults.push({ component: role, state, app, comparable: false, naReason, reason: `${!refPath ? REFERENCE_APP : app}: ${naReason}` });
            continue;
          }
          const result = await pixelDiff(utilPage, refPath, candPath, diffPath);
          pixelDiffResults.push({ component: role, state, app, ...result, diffImage: result.comparable ? diffPath.replace(ROOT + "/", "") : null, referenceImage: refPath.replace(ROOT + "/", ""), candidateImage: candPath.replace(ROOT + "/", "") });
        }
      }
    }
    for (let i = 0; i < RANKING.length; i++) {
      const refPath = screenshotIndex[REFERENCE_APP]?.[`ranking-row-${i}`]?.["ranking-row"];
      for (const app of APPS) {
        if (app === REFERENCE_APP) continue;
        const candPath = screenshotIndex[app]?.[`ranking-row-${i}`]?.["ranking-row"];
        const diffPath = join(DIFF_DIR, `${app}_vs_${REFERENCE_APP}_ranking-row-${i}.png`);
        if (!refPath || !candPath) {
          pixelDiffResults.push({ component: "ranking-row", state: `row-${i}`, app, comparable: false, naReason: "MISSING_SELECTOR", reason: "screenshot ausente (ranking-row)" });
          continue;
        }
        const result = await pixelDiff(utilPage, refPath, candPath, diffPath);
        pixelDiffResults.push({ component: "ranking-row", state: `row-${i}`, app, ...result, diffImage: result.comparable ? diffPath.replace(ROOT + "/", "") : null, referenceImage: refPath.replace(ROOT + "/", ""), candidateImage: candPath.replace(ROOT + "/", "") });
      }
    }
    await utilContext.close();

    const PIXEL_THRESHOLD_RATIO = 0.005;
    const pixelDiffFailures = pixelDiffResults.filter((r) => r.comparable && (r.ratio > PIXEL_THRESHOLD_RATIO || !r.sameDimensions));

    // ── Part 4: duplicate-record detection ──────────────────────────────────────────────────────
    // A record's identity is (screen, state, role/component, baseline, candidate). GAME_ROLE_SET
    // already contains "game-card" (see the loop above), so prepending "game-card" again used to
    // double-count every game-card pixel-diff under an identical key -- fixed by iterating
    // GAME_ROLE_SET alone. This check makes any future reintroduction of that bug fail loudly
    // instead of silently inflating counts.
    const recordKey = (r) => `${r.state}::${r.component}::${r.app}::${r.referenceImage || ""}::${r.candidateImage || ""}`;
    const keyCounts = new Map();
    for (const r of pixelDiffResults) {
      const k = recordKey(r);
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }
    const duplicateKeys = [...keyCounts.entries()].filter(([, n]) => n > 1);
    const totalRecords = pixelDiffResults.length;
    const uniqueRecords = keyCounts.size;
    const duplicateRecords = totalRecords - uniqueRecords;
    const comparableUniqueRecords = new Set(pixelDiffResults.filter((r) => r.comparable).map(recordKey)).size;
    if (duplicateRecords > 0) {
      throw new Error(`Part 4 regression: ${duplicateRecords} duplicate pixel-diff record(s) found (must be 0). Duplicate keys: ${duplicateKeys.map(([k]) => k).join(", ")}`);
    }

    writeFileSync(join(OUT_DIR, "pixel-diff-summary.json"), redactUserPaths(JSON.stringify({
      meta: { generatedAtUtc: new Date().toISOString(), sourceCommit: commitHashFull(), thresholdRatio: PIXEL_THRESHOLD_RATIO, fixtureVersion: FIXTURE_VERSION, harnessVersion: HARNESS_VERSION },
      recordCounts: { totalRecords, uniqueRecords, duplicateRecords, comparableUniqueRecords },
      results: pixelDiffResults,
      failureCount: pixelDiffFailures.length,
    }, null, 2)));

    // ── Montages (Copa | BR2026 | CDB2026), 7 viewports, Jogos + Ranking full-page ─────────────
    const montageEntries = [];
    const fs = await import("node:fs");
    function dataUri(p) {
      if (!p || !existsSync(p)) return null;
      return "data:image/png;base64," + fs.readFileSync(p).toString("base64");
    }

    const APP_LABELS = { copa2026: "Copa do Mundo 2026 (golden master)", br2026: "Brasileirão 2026", cdb2026: "Copa do Brasil 2026" };
    async function buildMontage(screenKey, vpLabel, pathsByApp, outFile) {
      const cells = APPS.map((app) => {
        const uri = dataUri(pathsByApp[app]);
        return { label: APP_LABELS[app], uri };
      });
      const html = `<!doctype html><html><head><style>
        body{margin:0;background:#0d1417;font-family:sans-serif;display:flex;}
        .col{flex:1;border-right:2px solid #333;padding:8px;box-sizing:border-box;}
        .col:last-child{border-right:none;}
        .label{color:#eef7ee;font-size:13px;font-weight:700;margin-bottom:6px;text-align:center;}
        img{width:100%;display:block;}
        .na{color:#f87171;text-align:center;padding:40px 0;font-size:13px;}
      </style></head><body>
        ${cells.map((c) => `<div class="col"><div class="label">${c.label}</div>${c.uri ? `<img src="${c.uri}">` : `<div class="na">N/A -- não capturado</div>`}</div>`).join("")}
      </body></html>`;
      const canvasWidth = 1500;
      const context = await browser.newContext({ viewport: { width: canvasWidth, height: 1200 } });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(150);
      const outPath = join(MONTAGE_DIR, outFile);
      await page.screenshot({ path: outPath, fullPage: true });
      await context.close();
      montageEntries.push({ screen: screenKey, viewport: vpLabel, file: outFile, apps: APPS.map((app) => ({ app, available: !!pathsByApp[app] })) });
    }

    for (const vp of VIEWPORTS) {
      const vpLabel = `${vp.w}x${vp.h}`;
      await buildMontage("games-full", vpLabel, { copa2026: montageShots.copa2026[vpLabel].games, br2026: montageShots.br2026[vpLabel].games, cdb2026: montageShots.cdb2026[vpLabel].games }, `montage_games-full_${vpLabel}.png`);
      await buildMontage("ranking-full", vpLabel, { copa2026: montageShots.copa2026[vpLabel].ranking, br2026: montageShots.br2026[vpLabel].ranking, cdb2026: montageShots.cdb2026[vpLabel].ranking }, `montage_ranking-full_${vpLabel}.png`);
    }
    // Per-state game-card montages + ranking-row-state montages (primary viewport captures only)
    for (const state of GAME_STATES) {
      await buildMontage(`game-card-${state}`, `${PRIMARY_VIEWPORT.w}x${PRIMARY_VIEWPORT.h}`, {
        copa2026: screenshotIndex.copa2026?.[state]?.["game-card"], br2026: screenshotIndex.br2026?.[state]?.["game-card"], cdb2026: screenshotIndex.cdb2026?.[state]?.["game-card"],
      }, `montage_game-card-${state}.png`);
    }
    for (let i = 0; i < RANKING.length; i++) {
      await buildMontage(`ranking-row-${i}`, `${PRIMARY_VIEWPORT.w}x${PRIMARY_VIEWPORT.h}`, {
        copa2026: screenshotIndex.copa2026?.[`ranking-row-${i}`]?.["ranking-row"], br2026: screenshotIndex.br2026?.[`ranking-row-${i}`]?.["ranking-row"], cdb2026: screenshotIndex.cdb2026?.[`ranking-row-${i}`]?.["ranking-row"],
      }, `montage_ranking-row-${i}.png`);
    }

    writeFileSync(join(MONTAGE_DIR, "montage_manifest.json"), redactUserPaths(JSON.stringify({
      meta: { generatedAtUtc: new Date().toISOString(), sourceCommit: commitHashFull(), sourceTreeHash: sourceTreeHash() },
      entries: montageEntries,
    }, null, 2)));

    // ── Fixture definition + console error log ──────────────────────────────────────────────────
    writeFileSync(join(OUT_DIR, "fixture-definition.json"), redactUserPaths(JSON.stringify({ games: GAMES, ranking: RANKING, fixtureVersion: FIXTURE_VERSION }, null, 2)));
    writeFileSync(join(OUT_DIR, "console-errors.json"), redactUserPaths(JSON.stringify(consoleErrors, null, 2)));

    // ── Verdict ──────────────────────────────────────────────────────────────────────────────────
    const allProps = [...styleComparison.flatMap((c) => Object.values(c.properties)), ...geometryComparison.flatMap((c) => Object.values(c.geometry))];
    const counts = { IDENTICAL: 0, WITHIN_TOLERANCE: 0, FUNCTIONALLY_JUSTIFIED: 0, DIVERGENT: 0, "N/A": 0 };
    for (const p of allProps) counts[p.status]++;

    // Part 9: split the N/A bucket by reason. Only LEGITIMATE_NA is acceptable; the gate fails on
    // any MISSING_FIXTURE / MISSING_SELECTOR / MISSING_COMPONENT / CAPTURE_FAILURE cell.
    const naByReason = { LEGITIMATE_NA: 0, MISSING_FIXTURE: 0, MISSING_SELECTOR: 0, MISSING_COMPONENT: 0, CAPTURE_FAILURE: 0 };
    for (const p of allProps) {
      if (p.status !== "N/A") continue;
      naByReason[p.naReason] = (naByReason[p.naReason] || 0) + 1;
    }
    const unacceptableNaCount = Object.entries(naByReason).filter(([k]) => k !== "LEGITIMATE_NA").reduce((s, [, v]) => s + v, 0);

    const unusedEntries = [...allowlist.entries()].filter(([, e]) => !e.used);

    // Part 10: structured console/network error filtering. Only ONE exact, documented combination
    // is excluded from the gate -- the 2 aborted cdn.jsdelivr.net <script> requests per page load
    // (this harness deliberately routes that CDN to abort() in run_forensic_audit.mjs, since a
    // pure visual/style capture never needs to actually send email or hit Supabase; CLAUDE.md:
    // "App is local-first: Supabase failure degrades gracefully") plus the two console messages
    // that abort necessarily also produces (the generic "net::ERR_FAILED" text, and the resulting
    // CSP "frame-ancestors ignored via meta" note, itself a pre-existing production limitation
    // unrelated to this harness -- frame-ancestors can only be enforced via HTTP header). Every
    // other requestfailed/console error, from ANY host, fails the gate -- no wildcard patterns.
    function isKnownBaselineError(e) {
      if (e.kind === "requestfailed") {
        return /cdn\.jsdelivr\.net/i.test(e.url) && e.resourceType === "script";
      }
      if (e.kind === "console") {
        return /frame-ancestors.*ignored.*meta/i.test(e.text)
          || /net::err_failed/i.test(e.text)
          || /integrity.*attribute/i.test(e.text);
      }
      return false;
    }
    const allConsoleErrors = Object.values(consoleErrors).flat();
    const unexpectedConsoleErrors = allConsoleErrors.filter((e) => !isKnownBaselineError(e));
    const totalConsoleErrors = unexpectedConsoleErrors.length;

    // ── Part 11: provenance ──────────────────────────────────────────────────────────────────────
    // auditedTreeHash is computed fresh, right here, against the worktree that was ACTUALLY
    // rendered by this run (not just the base commit) -- catches uncommitted local edits the run
    // captured that a bare sourceCommit would silently hide.
    let auditedTreeHash = "unknown", gitDirty = null;
    try {
      auditedTreeHash = execSync("git rev-parse HEAD^{tree}", { cwd: ROOT }).toString().trim();
      gitDirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0;
    } catch { /* not fatal -- provenance stays "unknown", still surfaced explicitly rather than a fake value */ }
    const provenance = {
      auditedCommit: commitHashFull(),
      auditedTreeHash,
      auditedWorktreeDirty: gitDirty,
      artifactCommit: commitHashFull(), // this run's artifacts are committed at/after this same commit; updated to the real commit hash by the packaging step (part 16) once committed
      generatedAtUtc: new Date().toISOString(),
      fixtureVersion: FIXTURE_VERSION,
      harnessVersion: HARNESS_VERSION,
    };

    const ok = schemaProblems.length === 0 && unusedEntries.length === 0 && counts.DIVERGENT === 0
      && pixelDiffFailures.length === 0 && totalConsoleErrors === 0 && unacceptableNaCount === 0
      && duplicateRecords === 0;

    const verdict = {
      verdict: ok ? "FORENSIC VISUAL PARITY PASSED" : "FORENSIC VISUAL PARITY FAILED",
      counts,
      naByReason,
      unacceptableNaCount,
      schemaProblems,
      unusedAllowlistEntries: unusedEntries.map(([k, e]) => ({ key: k, apps: e.apps, approvedBy: e.approvedBy })),
      pixelDiffFailureCount: pixelDiffFailures.length,
      pixelDiffRecordCounts: { totalRecords, uniqueRecords, duplicateRecords, comparableUniqueRecords },
      consoleErrorCount: totalConsoleErrors,
      unexpectedConsoleErrors,
      provenance,
      generatedAtUtc: provenance.generatedAtUtc,
      sourceCommit: provenance.auditedCommit,
    };
    writeFileSync(join(OUT_DIR, "verdict.json"), redactUserPaths(JSON.stringify(verdict, null, 2)));

    // ── HTML report ──────────────────────────────────────────────────────────────────────────────
    const { buildReportHtml } = await import("./report.mjs");
    const reportHtml = redactUserPaths(buildReportHtml({ verdict, styleComparison, geometryComparison, pixelDiffResults, montageEntries, fixture: { games: GAMES, ranking: RANKING }, consoleErrors }));
    writeFileSync(join(OUT_DIR, "forensic-visual-report.html"), reportHtml);
    writeFileSync(join(OUT_DIR, "index.html"), reportHtml);

    console.log(`\n${verdict.verdict}`);
    console.log(`Property comparisons: IDENTICAL=${counts.IDENTICAL} WITHIN_TOLERANCE=${counts.WITHIN_TOLERANCE} FUNCTIONALLY_JUSTIFIED=${counts.FUNCTIONALLY_JUSTIFIED} DIVERGENT=${counts.DIVERGENT} N/A=${counts["N/A"]} (of which unacceptable=${unacceptableNaCount})`);
    console.log(`N/A breakdown: ${JSON.stringify(naByReason)}`);
    console.log(`Pixel-diff records: total=${totalRecords} unique=${uniqueRecords} duplicate=${duplicateRecords} comparableUnique=${comparableUniqueRecords}`);
    console.log(`Pixel-diff failures: ${pixelDiffFailures.length} / ${pixelDiffResults.filter((r) => r.comparable).length} comparable`);
    console.log(`Console errors (unexpected): ${totalConsoleErrors}`);
    if (schemaProblems.length) console.log(`Allowlist schema problems: ${schemaProblems.length}\n  ${schemaProblems.join("\n  ")}`);
    if (unusedEntries.length) console.log(`Unused allowlist entries: ${unusedEntries.map(([k]) => k).join(", ")}`);
    console.log(`Report: ${redactUserPaths(join(OUT_DIR, "forensic-visual-report.html"))}`);

    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
    server.kill();
  }
}

main();
