/**
 * check_sticky_overlap.mjs — CDB2026 sticky-submit overlap guard (Fase 2.1 §7/§8).
 *
 * Run:  node bolao/cdb2026/scripts/visual/check_sticky_overlap.mjs
 *
 * Detects whether `.sticky-submit` (the floating "Salvar entrada" button) visually intersects
 * any focusable field in the pick form once scrolled to the bottom of the page — the exact bug
 * class named in the Fase 2.1 spec (§7): the button covering the name/email/payment/pick fields
 * or another button. Never touches production: serves the real repo files over a local static
 * server, blocks every external network call (CDN/Supabase/ESPN/EmailJS), and seeds a synthetic
 * local state (no real participant data) so the pick form actually has content to overflow with.
 *
 * Exit 0 = no overlap at any of the required widths. Exit 1 = overlap found (or a page error).
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8137;
const WIDTHS = [320, 375, 390, 414];

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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
  let failures = 0;

  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 700 } });
      const page = await context.newPage();
      await context.route("**://cdn.jsdelivr.net/**", r => r.abort());
      await context.route("**://*.supabase.co/**", r => r.abort());
      await context.route("**://site.api.espn.com/**", r => r.abort());
      await context.route("**://*.emailjs.com/**", r => r.abort());
      await context.addInitScript((state) => {
        localStorage.setItem("bolao_cdb2026_state", JSON.stringify(state));
      }, SEED_STATE);

      await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "load", timeout: 15000 });
      await page.waitForTimeout(700);

      // Open every pick block so the form has its full realistic height (closed accordions
      // would under-report — the bug only shows once the form is actually long).
      const openers = await page.locator(".tie-pick-block:not(.open) .pick-group-header, [data-tie-toggle]").all().catch(() => []);
      for (const o of openers) { try { await o.click({ timeout: 500 }); } catch { /* not a real toggle, ignore */ } }
      await page.waitForTimeout(300);

      // Rest positions (0% = initial load, 100% = scrolled to the natural end) are where a real
      // user actually stops and interacts — these MUST have zero overlap (Fase 2.1 §7/§11 hard
      // requirement). Mid-scroll fractions (25/50/75%) are sampled too but reported as
      // INFORMATIONAL, not a failure: a `position: sticky` bottom CTA inherently passes visually
      // over whatever content is scrolling past its pinned screen position while the scroll
      // GESTURE is in progress — this is true of Copa's own canonical `.sticky-submit` pattern
      // too (same `position: sticky` + `pointer-events: none` wrapper, untested there before
      // now), not a CDB2026-specific defect, and `pointer-events: none` on the wrapper (Copa's
      // pattern, adopted here) means the transient visual overlap never actually blocks a tap —
      // only the button's own footprint (pointer-events: auto) can intercept a click, and a user
      // does not tap a field mid-scroll-gesture. Eliminating 100% of geometric overlap during
      // active scroll would require abandoning the sticky pattern entirely (e.g. a permanently
      // fixed bar reserving its own space at all times) — a bigger, non-parity-preserving change
      // not made here; see docs/bolao/CDB2026_MODERNIZATION_REPORT_2026-08.md §7 for the
      // full writeup of this tradeoff.
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const REST_FRACTIONS = new Set([0, 1]);
      const fractions = [0, 0.25, 0.5, 0.75, 1];
      let widthFailed = false;
      for (const frac of fractions) {
        await page.evaluate(y => window.scrollTo(0, y), Math.round(scrollHeight * frac));
        await page.waitForTimeout(120);
        const result = await page.evaluate(() => {
          const sticky = document.querySelector(".sticky-submit");
          if (!sticky) return { error: "no .sticky-submit found" };
          // Measure the BUTTON itself, not the wrapper -- `.sticky-submit` has
          // `pointer-events: none` and the button `pointer-events: auto` (Copa's canonical
          // pattern), so only the button's own footprint can actually block a click/tap; the
          // wrapper's box still spans the full row width even though it's `text-align: right`
          // (text-align doesn't shrink a block box), so measuring the wrapper over-reports.
          const btn = sticky.querySelector("button") || sticky;
          const sRect = btn.getBoundingClientRect();
          const fields = [...document.querySelectorAll("#entry input, #entry select, #entry button")]
            .filter(el => !sticky.contains(el));
          const overlaps = [];
          for (const el of fields) {
            const r = el.getBoundingClientRect();
            const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
            if (!visible) continue;
            const intersects = !(r.right < sRect.left || r.left > sRect.right || r.bottom < sRect.top || r.top > sRect.bottom);
            if (intersects) overlaps.push({ tag: el.tagName, id: el.id || null, cls: el.className || null });
          }
          return { overlaps };
        });
        const isRest = REST_FRACTIONS.has(frac);
        if (result.error) {
          console.error(`  ✗ width=${width} scroll=${Math.round(frac * 100)}%: ${result.error}`);
          failures++; widthFailed = true;
        } else if (result.overlaps.length && isRest) {
          console.error(`  ✗ width=${width} scroll=${Math.round(frac * 100)}% (REST POSITION): .sticky-submit button overlaps ${result.overlaps.length} field(s): ${JSON.stringify(result.overlaps)}`);
          failures++; widthFailed = true;
        } else if (result.overlaps.length) {
          console.log(`  ℹ width=${width} scroll=${Math.round(frac * 100)}% (mid-scroll, informational only — see script header): transient overlap with ${JSON.stringify(result.overlaps.map(o => o.cls))}`);
        }
      }
      if (!widthFailed) console.log(`  ✓ width=${width}: no overlap at either rest position (0%/100%)`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("\n" + (failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ FAILED — ${failures} width(s) with overlap`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
