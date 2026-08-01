/**
 * check_sticky_overlap.mjs — CDB2026 "Salvar entrada" CTA overlap guard (Fase 2.2 §1/§2/§4).
 *
 * Run:  node bolao/cdb2026/scripts/visual/check_sticky_overlap.mjs
 *
 * Fase 2.1's version only checked intersection against `#entry input, select, button` — too
 * narrow. A real regression (confirmed in an independent review of the Fase 2.1 evidence,
 * 390x844 mobile) had the CTA visually covering the "Nova entrada" `<h2>` — a heading, not a
 * focusable control, so the old test never saw it. Fase 2.2 §1 fix: the CTA no longer floats at
 * all (position: sticky/fixed removed, see css/styles.css `.sticky-submit` comment) — it lives in
 * normal document flow, which makes overlap with ANYTHING structurally impossible (a normal-flow
 * block cannot visually occupy the same screen position as a sibling unless one is deliberately
 * positioned to do so). This test doesn't just trust that claim — it verifies it directly against
 * a broad set of visible, content-bearing element types, at every required viewport, at multiple
 * scroll positions, with a full-detail failure report (element tag, visible text, both rects).
 *
 * Never touches production: serves the real repo over a local static server, blocks every
 * external network call, seeds synthetic (no real participant) state via addInitScript().
 *
 * Exit 0 = no overlap anywhere. Exit 1 = overlap found (full JSON detail printed) or a page error.
 */
import { loadChromium } from "./playwright_loader.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8137;
// Fase 2.2 §3: all 7 required viewports, not just the 4 mobile ones — a normal-flow CTA has no
// reason to behave differently at desktop widths, but we don't assume that, we check it.
const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 414, h: 896 },
  { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 },
];

const SEED_STATE = {
  entries: [], deletedIds: [], paid: {},
  phases: {
    oitavas: {
      cutoffAt: null,
      ties: {
        t1: { teamA: "Vasco", teamB: "Fluminense", matches: { first: { kickoff: "2030-08-01T20:30:00Z", status: "SCHEDULED" }, second: { status: "SCHEDULED" } } },
        t2: { teamA: "Corinthians", teamB: "Grêmio", matches: { first: { kickoff: "2030-08-02T22:30:00Z", status: "SCHEDULED" }, second: { status: "SCHEDULED" } } },
        t3: { teamA: "Santos", teamB: "Bahia", matches: { first: { kickoff: "2030-08-03T22:30:00Z", status: "SCHEDULED" }, second: { status: "SCHEDULED" } } },
      },
    },
    final: { cutoffAt: null, ties: { f1: { teamA: "Vasco", teamB: "Grêmio", matches: { single: { kickoff: "2030-11-01T22:00:00Z", status: "SCHEDULED" } } } } },
  },
  espnSync: { activePhaseId: "oitavas", seededKnownConfrontos: true, backfilledOitavasKickoffs: true, healedFalseAutoResults: true, healedPhantomTies: true },
  auditLog: [], meta: { updatedAt: null, version: "test" },
};

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
    p.on("error", reject);
    setTimeout(() => resolve(p), 700);
  });
}

// Fase 2.2 §4: element types a CTA must never visually cover, not just focusable controls.
const RELEVANT_SELECTOR = [
  "h1", "h2", "h3", "h4", "p", "label", "small", "span",
  "input", "select", "textarea", "button", "a",
  ".card", ".form-group", ".notice", ".alert", ".receipt",
].join(", ");

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium", headless: true });
  let failures = 0;
  const allFindings = [];

  try {
    for (const vp of VIEWPORTS) {
      const label = `${vp.w}x${vp.h}`;
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await context.newPage();
      await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
      await context.route("**://*.supabase.co/**", r => r.abort());
      await context.route("**://site.api.espn.com/**", r => r.abort());
      await context.route("**://*.emailjs.com/**", r => r.abort());

      // context.addInitScript() is unreliable in this sandbox for seeding localStorage (a
      // Playwright-driver/Chromium version mismatch silently drops the write — see
      // capture_evidence.mjs's comment for the isolated repro). Seed post-load + reload instead.
      await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "load", timeout: 15000 });
      await page.evaluate((state) => localStorage.setItem("bolao_cdb2026_state", JSON.stringify(state)), SEED_STATE);
      await page.reload({ waitUntil: "load", timeout: 15000 });
      await page.waitForTimeout(700);

      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const fractions = [0, 0.25, 0.5, 0.75, 1];
      let widthFailed = false;

      for (const frac of fractions) {
        await page.evaluate(y => window.scrollTo(0, y), Math.round(scrollHeight * frac));
        await page.waitForTimeout(120);

        const result = await page.evaluate((sel) => {
          const cta = document.querySelector(".sticky-submit");
          if (!cta) return { error: "no .sticky-submit found" };
          const ctaBtn = cta.querySelector("button") || cta;
          const ctaRect = ctaBtn.getBoundingClientRect();

          function isVisible(el) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            return true;
          }
          function hasOwnText(el) {
            // Only count elements with direct, visible text content (or, for structural
            // containers like .card, any content at all) — skip decorative wrappers with no
            // text of their own (their text-bearing children are checked independently).
            const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
            if (direct) return true;
            if (el.matches(".card, .form-group, .notice, .alert, .receipt")) return el.textContent.trim().length > 0;
            return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(el.tagName);
          }

          const candidates = [...document.querySelectorAll(sel)];
          const overlaps = [];
          for (const el of candidates) {
            if (cta.contains(el) || el === cta) continue; // children of the CTA itself don't count
            if (!isVisible(el)) continue;
            if (!hasOwnText(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= window.innerHeight) continue; // not in viewport right now
            const intersects = !(r.right < ctaRect.left || r.left > ctaRect.right || r.bottom < ctaRect.top || r.top > ctaRect.bottom);
            if (intersects) {
              overlaps.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || "").trim().slice(0, 60),
                elementRect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
              });
            }
          }
          return { overlaps, ctaRect: { top: ctaRect.top, left: ctaRect.left, right: ctaRect.right, bottom: ctaRect.bottom } };
        }, RELEVANT_SELECTOR);

        if (result.error) {
          console.error(`  ✗ viewport=${label} scroll=${Math.round(frac * 100)}%: ${result.error}`);
          failures++; widthFailed = true;
          continue;
        }
        if (result.overlaps.length) {
          for (const ov of result.overlaps) {
            const finding = {
              viewport: label, scrollPct: Math.round(frac * 100), cta: ".sticky-submit",
              overlappedElement: ov.tag, text: ov.text, ctaRect: result.ctaRect, elementRect: ov.elementRect,
            };
            allFindings.push(finding);
            console.error(`  ✗ ${JSON.stringify(finding)}`);
          }
          failures++; widthFailed = true;
        }
      }
      if (!widthFailed) console.log(`  ✓ viewport=${label}: no overlap at any sampled scroll position (0/25/50/75/100%)`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("\n" + (failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ FAILED — ${allFindings.length} overlap finding(s) across ${failures} viewport/scroll combination(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
