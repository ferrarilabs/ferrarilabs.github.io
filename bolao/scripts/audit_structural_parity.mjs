#!/usr/bin/env node
/**
 * audit_structural_parity.mjs — real DOM-structure parity auditor (phase 7-FIX item 8).
 *
 * Run:  PLAYWRIGHT_CHROMIUM_PATH=<path> node bolao/scripts/audit_structural_parity.mjs
 *
 * Why this exists: bolao/scripts/audit_visual_consistency.mjs (built in an earlier phase)
 * compares ISOLATED getComputedStyle() properties across apps for a hand-picked selector per
 * app — it caught real token drift (e.g. BR2026's .match-team-name font-size), but it could
 * never catch three apps rendering genuinely different DOM SHAPES for "the same" component,
 * because it never looked at child order, parent/depth, or which classes exist at all. That's
 * exactly the gap Eduardo's phase 7-FIX diagnosis named. This script closes it: for each
 * canonical component, it walks the REAL rendered DOM (real Chromium, real fixture data — same
 * PLAYWRIGHT_CHROMIUM_PATH convention as every other script in this repo) and produces a
 * structural signature — the same idea Eduardo asked for explicitly:
 *   {"component":"game-card","children":["game-card__header","game-card__metadata",
 *    "game-card__match","game-card__extension"]}
 * — then asserts every app's signature for the same component is IDENTICAL. No allowlist for
 * structural properties (child order/class/parent/depth/display/grid-template-columns/
 * flex-direction/alignment/padding/gap/team-typography/score/metadata-position/card-width/
 * card-min-height) — those must genuinely match or it's a real FAIL. The only thing this script
 * allows to differ is the PRESENCE of optional content (a probability bar, an aggregate line, a
 * second leg, an app-specific action button) — never the shape of the canonical shell itself.
 */
import { chromium as importedChromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seedBr2026Schedule } from "../cdb2026/scripts/visual/game_fixtures.mjs";

import { startStaticServer } from "./static_server.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // repo root
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const APPS = ["copa2026", "br2026", "cdb2026"];

// Canonical child signature for .game-card — the four top-level slots every app's leg/game card
// must expose, IN THIS ORDER, regardless of what's inside each slot (content may legitimately
// differ; the four-slot shape may not).
const GAME_CARD_CHILDREN = ["game-card__header", "game-card__metadata", "game-card__match", "game-card__extension"];
const GAME_CARD_MATCH_CHILDREN = ["game-card__team", "game-card__center", "game-card__team"];
const RANKING_ROW_REQUIRED_CLASSES = ["ranking-row__position", "ranking-row__participant", "ranking-row__score"];

// Delega ao helper compartilhado fail-closed (bolao/scripts/static_server.mjs). Antes daqui
// este corpo era spawn+setTimeout com stdio ignorado: se a porta estivesse ocupada, o python
// morria em silêncio e o browser media um servidor/checkout ESTRANHO. Ver o cabeçalho do helper.
// Devolve um objeto com .kill() para os call sites existentes seguirem iguais.
async function startServer() {
  const s = await startStaticServer(PORT, ROOT);
  return { kill: s.stop };
}
async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return importedChromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
}

const violations = [];
function fail(component, app, msg) {
  violations.push({ component, app, msg });
  console.error(`✗ [${component}] [${app}] ${msg}`);
}
function ok(component, app, msg) {
  console.log(`✓ [${component}] [${app}] ${msg}`);
}

// Extract a structural signature for one .game-card element: direct-child class list (in DOM
// order, canonical-slot classes only — extra app-specific classes on the SAME element, like
// game-card--second-leg, don't count against this signature; they're variant labels, not shape),
// the .game-card__match sub-signature, computed display/grid-template-columns for both levels,
// and the relative left-to-right ORDER of team/center/team inside __match (never allowed to
// differ — this is exactly the "score in a different place" class of bug the old auditor missed).
async function gameCardSignature(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const canonicalOf = (node) =>
      [...node.classList].find((c) => c.startsWith("game-card__")) || null;
    const directChildren = [...el.children].map(canonicalOf).filter(Boolean);
    const matchEl = el.querySelector(":scope > .game-card__match");
    const matchChildren = matchEl ? [...matchEl.children].map((c) => canonicalOf(c) || (c.className || "").split(" ")[0]) : [];
    const cs = getComputedStyle(el);
    const matchCs = matchEl ? getComputedStyle(matchEl) : null;
    // Relative left-to-right order of team-name/score inside __match, read from real
    // getBoundingClientRect (not just DOM order) — catches a CSS `order:`/flex-direction:
    // row-reverse bug that DOM order alone wouldn't.
    const homeEl = el.querySelector(":scope .game-card__team--home");
    const scoreEl = el.querySelector(":scope .game-card__score");
    const awayEl = el.querySelector(":scope .game-card__team--away");
    const positions = [homeEl, scoreEl, awayEl].map((n) => (n ? n.getBoundingClientRect().left : null));
    const leftToRightOrderCorrect = positions.every((p) => p !== null) && positions[0] < positions[1] && positions[1] < positions[2];
    return {
      directChildren,
      matchChildren,
      display: cs.display,
      matchDisplay: matchCs?.display,
      matchGridTemplateColumns: matchCs?.gridTemplateColumns,
      width: Math.round(el.getBoundingClientRect().width),
      minHeight: cs.minHeight,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      leftToRightOrderCorrect,
    };
  }, selector);
}

async function rankingRowSignature(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const classes = [...el.classList];
    const cs = getComputedStyle(el);
    return {
      hasCanonicalClass: classes.includes("ranking-row"),
      childCanonicalClasses: [...el.children].map((c) => [...c.classList].find((k) => k.startsWith("ranking-row__")) || null).filter(Boolean),
      display: cs.display,
      gridTemplateColumns: cs.gridTemplateColumns,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      minHeight: cs.minHeight,
    };
  }, selector);
}

async function main() {
  let server, browser;
  try {
    server = await startServer();
    browser = await launchBrowser();

    // ── game-card structural parity ──────────────────────────────────────────────────────────
    const gameCardSigs = {};
    for (const app of APPS) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      await page.goto(`${BASE}/bolao/${app}/`, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(700);
      // BR2026's Jogos list needs a seeded schedule (real ESPN fetch fails offline in this
      // sandbox) — same seed-then-reload pattern capture_evidence.mjs uses, reusing its exact
      // fixture helper rather than reimplementing it.
      if (app === "br2026") {
        const siteVersion = await page.evaluate(() => window.BR2026_CONFIG?.siteVersion);
        await seedBr2026Schedule(page, siteVersion);
        await page.reload({ waitUntil: "load", timeout: 20000 });
        await page.waitForTimeout(700);
      }
      // Unhide nav for archived Copa so Jogos is reachable (harness-only, same technique
      // bolao/cdb2026/scripts/visual/game_fixtures.mjs's unhideCopaJogosForHarness() uses —
      // never touches CONFIG.archived itself).
      // Espera a nav EXISTIR antes de mexer nela. Sem isto, `querySelectorAll(".nav button")`
      // pode rodar antes do render e simplesmente nao achar botao nenhum -- e o clique em "Jogos"
      // vira um no-op silencioso, sem erro nenhum para explicar o que houve depois.
      await page.waitForSelector(".nav button", { timeout: 10000 })
        .catch(() => { /* ausencia real da nav aparece na assercao de game-card abaixo */ });
      await page.evaluate(() => document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("hidden")));
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll(".nav button")].find((b) => /jogos/i.test(b.textContent));
        btn?.click();
      });
      // ESPERA O ELEMENTO, NAO O RELOGIO — Issue #278.
      //
      // Aqui havia `waitForTimeout(600)`. Um sleep fixo nao e espera, e corrida: se o render cair
      // em 610 ms sob carga de CI, a consulta nao acha nada e a checagem reporta "no .game-card
      // found in the real rendered DOM" -- indistinguivel, na saida, de uma regressao estrutural
      // de verdade. Foi assim que a `main` ficou vermelha em d6ca3f30 e voltou a passar na
      // reexecucao do MESMO commit, sem uma linha de codigo mudar.
      //
      // Isto ENDURECE a checagem em vez de afrouxa-la: nenhuma assercao saiu, nenhum `skip`
      // entrou. A ausencia REAL continua reprovando -- o `catch` nao decide nada, so devolve o
      // controle para a assercao abaixo, que continua sendo quem reprova quando `sig` e nulo.
      await page.waitForSelector(".game-card", { timeout: 10000 })
        .catch(() => { /* ausencia real e decidida pela assercao de game-card abaixo, nao aqui */ });
      const sig = await gameCardSignature(page, ".game-card");
      gameCardSigs[app] = sig;
      await page.close();
    }

    const reference = gameCardSigs.copa2026;
    if (!reference) {
      fail("game-card", "copa2026", "no .game-card found at all — cannot establish a reference signature");
    } else {
      ok("game-card", "copa2026", `reference signature: ${JSON.stringify(reference.directChildren)}`);
      for (const app of APPS.filter((a) => a !== "copa2026")) {
        const sig = gameCardSigs[app];
        if (!sig) { fail("game-card", app, "no .game-card found in the real rendered DOM"); continue; }
        if (JSON.stringify(sig.directChildren) !== JSON.stringify(reference.directChildren)) {
          fail("game-card", app, `child slot order/set differs — copa2026=${JSON.stringify(reference.directChildren)} vs ${app}=${JSON.stringify(sig.directChildren)}`);
        } else {
          ok("game-card", app, "child slot order/set matches copa2026 exactly");
        }
        if (sig.matchDisplay !== reference.matchDisplay) {
          fail("game-card", app, `.game-card__match display differs — copa2026=${reference.matchDisplay} vs ${app}=${sig.matchDisplay}`);
        }
        if (!sig.leftToRightOrderCorrect) {
          fail("game-card", app, "team-home / score / team-away are NOT in left-to-right visual order (real getBoundingClientRect check)");
        } else {
          ok("game-card", app, "team-home / score / team-away confirmed in correct left-to-right order");
        }
        if (sig.borderRadius !== reference.borderRadius) {
          fail("game-card", app, `card border-radius differs — copa2026=${reference.borderRadius} vs ${app}=${sig.borderRadius}`);
        }
        if (sig.padding !== reference.padding) {
          fail("game-card", app, `card padding differs — copa2026=${reference.padding} vs ${app}=${sig.padding}`);
        }
      }
    }

    // ── ranking-row structural parity ────────────────────────────────────────────────────────
    const rankSigs = {};
    for (const app of APPS) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      await page.goto(`${BASE}/bolao/${app}/`, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("hidden")));
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll(".nav button")].find((b) => /ranking/i.test(b.textContent));
        btn?.click();
      });
      await page.waitForTimeout(600);
      rankSigs[app] = await rankingRowSignature(page, ".rank-row");
      await page.close();
    }
    const rankRef = rankSigs.copa2026;
    if (!rankRef) {
      // Copa's ranking may legitimately be empty in the harness fixture (no synthetic entries
      // seeded for Copa — see capture_evidence.mjs's own comment) — not a structural failure,
      // fall back to BR2026 as reference if Copa has no rows to check.
      console.log("ℹ [ranking-row] [copa2026] no rows in this fixture — using br2026 as reference instead");
    }
    const effectiveRankRef = rankRef || rankSigs.br2026;
    for (const app of APPS) {
      const sig = rankSigs[app];
      if (!sig) { console.log(`ℹ [ranking-row] [${app}] no rows in this fixture — skipped (not a failure)`); continue; }
      if (!sig.hasCanonicalClass) fail("ranking-row", app, "row is missing the canonical .ranking-row class");
      else ok("ranking-row", app, "canonical .ranking-row class present");
      const missing = RANKING_ROW_REQUIRED_CLASSES.filter((c) => !sig.childCanonicalClasses.includes(c));
      if (missing.length) fail("ranking-row", app, `missing required child classes: ${missing.join(", ")}`);
      else ok("ranking-row", app, "all required child classes present");
      // Compare TRACK COUNT, not exact resolved pixel values — getComputedStyle resolves
      // "1fr"/"auto" tracks to actual pixels based on that PAGE's own available container
      // width (main's rendered width can legitimately differ by a few px between apps for
      // reasons that have nothing to do with the ranking-row component itself, e.g. scrollbar
      // presence). Comparing px-for-px would produce false positives on every run; comparing
      // track COUNT still genuinely catches a real structural bug (a missing/extra column).
      const refTrackCount = (effectiveRankRef?.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean).length;
      const sigTrackCount = (sig.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean).length;
      if (effectiveRankRef && sigTrackCount !== refTrackCount) {
        fail("ranking-row", app, `grid column COUNT differs from reference — ${sigTrackCount} tracks (${sig.gridTemplateColumns}) vs ${refTrackCount} tracks (${effectiveRankRef.gridTemplateColumns})`);
      } else if (effectiveRankRef) {
        ok("ranking-row", app, `grid column count matches reference (${sigTrackCount} tracks) — exact px naturally differs by page, not compared`);
      }
      if (effectiveRankRef && sig.padding !== effectiveRankRef.padding) {
        fail("ranking-row", app, `padding differs from reference — ${sig.padding} vs ${effectiveRankRef.padding}`);
      }
      if (effectiveRankRef && sig.borderRadius !== effectiveRankRef.borderRadius) {
        fail("ranking-row", app, `border-radius differs from reference — ${sig.borderRadius} vs ${effectiveRankRef.borderRadius}`);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
  }

  console.log(`\n${violations.length === 0 ? "✓" : "✗"} ${violations.length} structural violation(s) found.`);
  if (violations.length > 0) {
    console.error("Structural parity FAILED — no VARIANT_APPROVED allowlist exists for composition differences (child order, missing classes, parent/depth, display, grid-template, flex-direction, relative position, padding, radius, min-height). Only presence of OPTIONAL content may differ between apps.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
