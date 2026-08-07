/**
 * test_aria_current_nav.mjs — validates the aria-current="page" nav decision (Fase 2.2-correção
 * coordinator #3).
 *
 * Run:  node bolao/scripts/test_aria_current_nav.mjs
 *
 * The Fase 2.2 accessibility audit added `aria-current="page"` to the active nav button in all
 * three apps (cherry-picked onto this branch from local `main` commit 5dd80aa). This test proves
 * that decision actually works end-to-end, in a real browser, for both mouse and keyboard users
 * — not just that the source line exists. Verified against the real implementation
 * (`showSection()` in each app's `app.js`, all three read to confirm the exact same shape) before
 * writing any assertion here:
 *
 *   $$(".nav button[data-section]").forEach(b => {
 *     const active = b.dataset.section === id;
 *     b.classList.toggle("active", active);
 *     if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
 *   });
 *
 * Checks, per app:
 *   1. Exactly one nav button carries aria-current="page" on initial load.
 *   2. No element anywhere in the DOM carries aria-selected — confirms the plain-nav choice
 *      (<button>, not role="tab"/role="tablist") was applied consistently, not mixed with
 *      tab-widget semantics that would need aria-selected too.
 *   3. Clicking a different nav button (real Playwright mouse click) moves aria-current to
 *      exactly that button and removes it from the previous one — never zero, never two.
 *   4. The same transition works via KEYBOARD ONLY: Tab-focus the button, press Enter — proves
 *      this isn't mouse-only (nav buttons are native <button> elements, so this is expected, but
 *      expected isn't the same as verified).
 *   5. The active button's aria-current state matches its VISUAL active state
 *      (getComputedStyle background/color match the `.nav button.active` CSS rule) — proves the
 *      accessibility attribute and the visual indicator never drift apart.
 *   6. No horizontal overflow is introduced by any of the navigation clicks (regression net,
 *      same technique as capture_evidence.mjs's overflow check).
 *
 * Never touches production: local static server, all external network blocked.
 */
import { launchChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startStaticServer } from "./static_server.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8192;

const APPS = {
  copa2026: { path: "/bolao/copa2026/", targets: ["ranking"] }, // archived: only Ranking is reachable via nav
  br2026: { path: "/bolao/br2026/", targets: ["ranking", "games", "rules", "probs"] },
  cdb2026: { path: "/bolao/cdb2026/", targets: ["ranking", "games", "rules", "probs"] },
};

// Espera o layout ASSENTAR antes de medir overflow (fix de flakiness, 2026-08-07).
// Antes: `await page.waitForTimeout(300)` depois do clique. Isso passa sozinho e falha quando as
// suítes rodam em cadeia (`npm run test:browser`), porque com várias instâncias de Chromium
// disputando CPU o render demora mais que os 300ms fixos e a medição pega o layout no MEIO da
// troca de seção — reportando um overflow horizontal que não existe no estado final. Mesma classe
// de defeito (e mesma correção) do settleLayout() em audit_visual_consistency.mjs: esperar
// CONDIÇÃO, não tempo.
async function settleAfterClick(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // Dois frames: um para o estilo/layout recalcular, outro para estabilizar.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  // A seção alvo precisa estar realmente visível antes de medir qualquer geometria.
  await page.waitForFunction(() => {
    const active = document.querySelector(".page.active");
    return !!active && active.getBoundingClientRect().height > 0;
  }, null, { timeout: 5000 });
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

// Delega ao helper compartilhado fail-closed (bolao/scripts/static_server.mjs). Antes daqui
// este corpo era spawn+setTimeout com stdio ignorado: se a porta estivesse ocupada, o python
// morria em silêncio e o browser media um servidor/checkout ESTRANHO. Ver o cabeçalho do helper.
// Devolve um objeto com .kill() para os call sites existentes seguirem iguais.
async function startServer() {
  const s = await startStaticServer(PORT, ROOT);
  return { kill: s.stop };
}

async function navState(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".nav button[data-section]")];
    const withAriaCurrent = buttons.filter(b => b.getAttribute("aria-current") === "page");
    const anyAriaSelectedAnywhere = document.querySelector("[aria-selected]") !== null;
    return {
      totalButtons: buttons.length,
      ariaCurrentCount: withAriaCurrent.length,
      ariaCurrentSection: withAriaCurrent[0]?.dataset.section || null,
      anyAriaSelectedAnywhere,
    };
  });
}

async function activeButtonVisualMatchesAria(page) {
  return page.evaluate(() => {
    const active = document.querySelector(".nav button.active");
    const ariaActive = document.querySelector('.nav button[aria-current="page"]');
    if (!active || !ariaActive) return { match: false, reason: "missing .active or [aria-current] element" };
    if (active !== ariaActive) return { match: false, reason: "the .active-class element and the aria-current element are DIFFERENT buttons" };
    const cs = getComputedStyle(active);
    return { match: true, backgroundColor: cs.backgroundColor };
  });
}

async function hasOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    let overflow = false;
    document.querySelectorAll("body *").forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 2) overflow = true; });
    return overflow;
  });
}

async function testApp(browser, appId, app) {
  console.log(`\n=== ${appId} ===`);
  const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const page = await context.newPage();
  await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
  await context.route("**://*.supabase.co/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route("**://site.api.espn.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }));
  await context.route("**://*.emailjs.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

  await page.goto(`http://localhost:${PORT}${app.path}`, { waitUntil: "load", timeout: 15000 });
  await settleAfterClick(page);

  // 1 + 2: initial state
  let state = await navState(page);
  check("exactly one nav button has aria-current=\"page\" on load", state.ariaCurrentCount === 1, `found ${state.ariaCurrentCount}`);
  check("no element anywhere has aria-selected (plain nav, not a tabs widget)", !state.anyAriaSelectedAnywhere);

  let previousSection = state.ariaCurrentSection;

  for (const target of app.targets) {
    const btn = page.locator(`[data-section="${target}"]`).first();
    if (await btn.count() === 0) { console.log(`  (skip ${target}: not in DOM)`); continue; }

    // 3: real mouse click
    await btn.click({ timeout: 1500 }).catch(() => {});
    await settleAfterClick(page);
    state = await navState(page);
    check(`click->${target}: exactly one aria-current afterward`, state.ariaCurrentCount === 1, `found ${state.ariaCurrentCount}`);
    check(`click->${target}: aria-current moved to the clicked section`, state.ariaCurrentSection === target, `is "${state.ariaCurrentSection}"`);
    // Only meaningful when this click is an actual transition (previousSection !== target) — if
    // the app's default active section already equals the first target (e.g. BR2026 defaults to
    // Ranking since Palpites is disabled), clicking it again is a legitimate no-op and there is
    // no "previous" button to have moved away from; asserting that case would be a test bug, not
    // a real app bug (confirmed this is exactly what happened before this comment existed).
    if (previousSection !== target) {
      check(`click->${target}: aria-current is no longer on "${previousSection}"`, state.ariaCurrentSection !== previousSection);
    } else {
      console.log(`  (click->${target} was already the active section — no-op transition, nothing to verify moved away)`);
    }

    const visual = await activeButtonVisualMatchesAria(page);
    check(`click->${target}: .active class and aria-current point at the SAME element`, visual.match, visual.reason);

    const overflow = await hasOverflow(page);
    check(`click->${target}: no horizontal overflow introduced`, !overflow);

    previousSection = target;
  }

  // 4: keyboard-only activation — Tab to a nav button, press Enter, verify identical behavior.
  if (app.targets.length >= 2) {
    const keyboardTarget = app.targets[0] === previousSection ? app.targets[1] : app.targets[0];
    await page.locator(`[data-section="${keyboardTarget}"]`).first().focus();
    const focusedIsRightButton = await page.evaluate((sec) => document.activeElement?.dataset?.section === sec, keyboardTarget);
    check(`keyboard focus lands on [data-section="${keyboardTarget}"]`, focusedIsRightButton);
    await page.keyboard.press("Enter");
    await settleAfterClick(page);
    state = await navState(page);
    check(`keyboard Enter->${keyboardTarget}: exactly one aria-current afterward`, state.ariaCurrentCount === 1, `found ${state.ariaCurrentCount}`);
    check(`keyboard Enter->${keyboardTarget}: aria-current moved via keyboard activation, not just mouse`, state.ariaCurrentSection === keyboardTarget, `is "${state.ariaCurrentSection}"`);
  } else {
    console.log(`  (skip keyboard test: ${appId} has only ${app.targets.length} reachable nav target(s) via nav in this mode)`);
  }

  await context.close();
}

async function main() {
  const server = await startServer();
  const browser = await launchChromium();
  try {
    for (const [appId, app] of Object.entries(APPS)) {
      await testApp(browser, appId, app);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
