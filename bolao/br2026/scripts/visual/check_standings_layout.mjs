/**
 * check_standings_layout.mjs — BR2026 standings table geometry guard.
 *
 * Run:  node bolao/br2026/scripts/visual/check_standings_layout.mjs
 *
 * Why this exists (2026-08-16, Eduardo: "enorme área vazia entre TIME e PTS" no desktop):
 * `.td-team` was declared `display: flex`. A <td>/<th> that is not `display: table-cell` stops
 * being a cell — the table wraps it in an ANONYMOUS table-cell, and THAT is the box the column
 * algorithm sizes. The anonymous cell carried no declared width, so under `table-layout: fixed`
 * it was the table's only `auto` column and absorbed every pixel of leftover width: 506px of void
 * between TIME and PTS at 1440 and 1728. The same defect ran the other way on narrow screens —
 * the auto column collapsed to 0px and the sticky cells only *looked* right because their opaque
 * backgrounds painted over the columns they were overlapping (J/V/E/D were unreachable at 390px).
 *
 * A screenshot-diff would not have caught either half of that reliably. These are geometric
 * invariants measured from real layout boxes:
 *
 *   1. CONTIGUITY   — adjacent columns share an edge (border-collapse). The historical desktop
 *                     defect shows up here as a 506px gap. This is the assertion the mutation
 *                     test targets.
 *   2. ALIGNMENT    — every header cell sits exactly above its body cell (no column drift).
 *   3. ORDER        — PTS < J < V < E < D < GP < GC < SG, left to right, each column non-degenerate.
 *   4. BOUNDS       — no cell escapes the table box.
 *   5. TEAM COLUMN  — flexible but bounded, and on desktop wide enough that no real team name
 *                     ("Athletico Paranaense", "Red Bull Bragantino") is ellipsised.
 *   6. NO PAGE OVERFLOW — document never scrolls horizontally at any viewport; only
 *                     .standings-wrap may, and only where the table is wider than it.
 *   7. STICKY       — scrolled to the far right on mobile, the four sticky cells land at exactly
 *                     their declared cumulative offsets and stay contiguous (the invariant whose
 *                     violation truncated "19" to "9" in the 2026-07-25 bug).
 *   8. ROW COLOUR   — real sampled pixels: a G4/SA/Z4 row is ONE continuous colour across its full
 *                     width. Before this fix the sticky half painted hand-picked solids that did
 *                     not match the translucent tint on the scrollable half, so zone rows read as
 *                     two detached blocks.
 *
 * Never touches production: serves the repo over a local static server and blocks every external
 * network call. Read-only — no state is seeded, no email, no database.
 *
 * Exit 0 = all invariants hold at every viewport. Exit 1 = at least one violation (detail printed).
 */
import { launchChromium } from "../../../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "../../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8139;
const DESKTOP_MIN = 900; // must match the @media (min-width: 900px) breakpoint in css/styles.css

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 414, h: 896 },
  { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }, { w: 1728, h: 900 },
];

// Column order as rendered. Index 0..3 are the sticky columns, 4..10 the scrollable stats.
const COLUMNS = ["#", "MOV", "TIME", "PTS", "J", "V", "E", "D", "GP", "GC", "SG"];
const STICKY_COUNT = 4;

// Sub-pixel tolerance. Adjacent collapsed-border cells share an edge exactly; anything beyond
// rounding noise is a real gap. Deliberately tight — the defect this guards against was 506px,
// but a 20px "small" gap is just as much a layout bug and must not slip through.
const EPS = 0.5;
// Max tolerated per-channel difference when comparing sampled background pixels of one row.
const COLOR_EPS = 3;

const findings = [];
function fail(viewport, check, detail) {
  findings.push({ viewport, check, ...detail });
  console.error(`  ✗ [${viewport}] ${check}: ${JSON.stringify(detail)}`);
}

async function measure(page) {
  return page.evaluate((COLUMNS) => {
    const table = document.querySelector(".standings-table");
    const wrap = document.querySelector(".standings-wrap");
    if (!table || !wrap) return { error: "standings table not rendered" };
    const headRow = table.querySelector("thead tr");
    const bodyRows = [...table.querySelectorAll("tbody tr")];
    if (!headRow || !bodyRows.length) return { error: "standings table has no rows" };

    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const cellsOf = row => [...row.children].map((c, i) => ({
      col: COLUMNS[i] || `col${i}`,
      display: getComputedStyle(c).display,
      text: (c.textContent || "").trim().slice(0, 24),
      ...box(c),
    }));

    return {
      table: box(table),
      wrap: box(wrap),
      wrapScrollWidth: wrap.scrollWidth,
      wrapClientWidth: wrap.clientWidth,
      head: cellsOf(headRow),
      body: cellsOf(bodyRows[0]),
      rowCount: bodyRows.length,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      // Team names whose text is clipped by their fixed-width box.
      ellipsised: [...table.querySelectorAll(".td-team-name")]
        .filter(n => n.scrollWidth > n.clientWidth + 0.5)
        .map(n => ({ name: n.textContent, needs: n.scrollWidth, has: n.clientWidth })),
      zoneRow: (() => {
        const tr = table.querySelector("tbody tr.g4-zone, tbody tr.sa6-zone, tbody tr.z4-zone");
        return tr ? { zone: tr.className, ...box(tr) } : null;
      })(),
    };
  }, COLUMNS);
}

/**
 * Sample real rendered pixels across a zone row. Screenshots come back as PNG bytes; rather than
 * pulling in a PNG decoder we hand the bytes back to the page and read them through a canvas.
 * Sampled at the row's top edge + a few px: clear of glyphs and of the collapsed border, so every
 * sample is background — which is exactly what must be uniform.
 *
 * Sampling stops at the scroller's right edge. On narrow screens the row box is deliberately wider
 * than .standings-wrap (that is the contained horizontal scroll), so anything past that edge is
 * clipped page background, not part of the row.
 */
async function sampleRowColors(page, row, wrap, wrapClientWidth) {
  const y = Math.round(row.top + 3);
  const left = Math.round(Math.max(row.left, wrap.left));
  const right = Math.round(Math.min(row.right, wrap.left + wrapClientWidth));
  const clip = { x: left, y, width: Math.max(1, right - left), height: 1 };
  const b64 = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async ({ b64 }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, 1).data;
    const out = [];
    for (let x = 2; x < img.width - 2; x += 4) {
      const i = x * 4;
      out.push({ x, rgb: [data[i], data[i + 1], data[i + 2]] });
    }
    return out;
  }, { b64 });
}

async function checkViewport(browser, vp) {
  const label = `${vp.w}x${vp.h}`;
  const isDesktop = vp.w >= DESKTOP_MIN;
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await context.newPage();
  for (const pattern of ["**://cdn.jsdelivr.net/**", "**://*.supabase.co/**", "**://site.api.espn.com/**", "**://*.emailjs.com/**"]) {
    await context.route(pattern, r => r.abort());
  }

  try {
    await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-section="standings"]');
      if (btn) btn.click();
    });
    await page.waitForSelector(".standings-table tbody tr", { timeout: 10000 });
    await page.waitForTimeout(400);

    const m = await measure(page);
    if (m.error) { fail(label, "render", { error: m.error }); return; }

    // ── 1. CONTIGUITY — the assertion that catches the historical desktop void. ──
    for (const which of ["head", "body"]) {
      const cells = m[which];
      for (let i = 0; i < cells.length - 1; i++) {
        const gap = cells[i + 1].left - cells[i].right;
        if (Math.abs(gap) > EPS) {
          fail(label, "contiguity", {
            row: which, between: `${cells[i].col} → ${cells[i + 1].col}`, gapPx: +gap.toFixed(1),
            leftCellRight: +cells[i].right.toFixed(1), rightCellLeft: +cells[i + 1].left.toFixed(1),
          });
        }
      }
    }

    // Every cell must be a real table-cell — the root cause was one that wasn't.
    for (const which of ["head", "body"]) {
      for (const c of m[which]) {
        if (c.display !== "table-cell") {
          fail(label, "cell-display", { row: which, col: c.col, display: c.display,
            note: "a non-table-cell <td>/<th> is wrapped in an anonymous cell and escapes the column algorithm" });
        }
      }
    }

    // ── 2. ALIGNMENT — header above body, no drift. ──
    for (let i = 0; i < Math.min(m.head.length, m.body.length); i++) {
      const dl = Math.abs(m.head[i].left - m.body[i].left);
      const dr = Math.abs(m.head[i].right - m.body[i].right);
      if (dl > EPS || dr > EPS) {
        fail(label, "header-body-alignment", {
          col: m.head[i].col, deltaLeft: +dl.toFixed(1), deltaRight: +dr.toFixed(1),
        });
      }
    }
    if (m.head.length !== COLUMNS.length || m.body.length !== COLUMNS.length) {
      fail(label, "column-count", { head: m.head.length, body: m.body.length, expected: COLUMNS.length });
    }

    // ── 3. ORDER — statistics strictly left-to-right, none degenerate. ──
    for (let i = STICKY_COUNT - 1; i < m.body.length - 1; i++) {
      if (!(m.body[i].left < m.body[i + 1].left)) {
        fail(label, "column-order", { expected: `${m.body[i].col} left of ${m.body[i + 1].col}`,
          lefts: [m.body[i].left, m.body[i + 1].left] });
      }
    }
    for (const c of m.body) {
      if (c.width < 24) fail(label, "column-degenerate", { col: c.col, width: +c.width.toFixed(1) });
    }

    // ── 4. BOUNDS — nothing escapes the table box. ──
    for (const c of m.body) {
      if (c.left < m.table.left - EPS || c.right > m.table.right + EPS) {
        fail(label, "cell-outside-table", { col: c.col,
          cell: [+c.left.toFixed(1), +c.right.toFixed(1)], table: [+m.table.left.toFixed(1), +m.table.right.toFixed(1)] });
      }
    }

    // ── 5. TEAM COLUMN — flexible but bounded; full names on desktop. ──
    const team = m.body[2];
    const minTeam = isDesktop ? 200 : 100;
    const maxTeam = isDesktop ? 320 : 200;
    if (team.width < minTeam || team.width > maxTeam) {
      fail(label, "team-column-bounds", { width: +team.width.toFixed(1), allowed: [minTeam, maxTeam] });
    }
    if (isDesktop && m.ellipsised.length) {
      fail(label, "team-name-truncated-on-desktop", { names: m.ellipsised });
    }

    // ── 6. NO PAGE-LEVEL HORIZONTAL OVERFLOW at any viewport. ──
    if (m.docScrollWidth > m.innerWidth + 1 || m.bodyScrollWidth > m.innerWidth + 1) {
      fail(label, "page-horizontal-overflow", {
        docScrollWidth: m.docScrollWidth, bodyScrollWidth: m.bodyScrollWidth, innerWidth: m.innerWidth,
      });
    }
    // Desktop must not need the contained scroller at all — the table has to fit its card.
    if (isDesktop && m.wrapScrollWidth > m.wrapClientWidth + 1) {
      fail(label, "desktop-table-overflows-card", {
        wrapScrollWidth: m.wrapScrollWidth, wrapClientWidth: m.wrapClientWidth, tableWidth: +m.table.width.toFixed(1),
      });
    }

    // ── 7. STICKY — declared offsets must describe the real boxes when scrolled. ──
    if (m.wrapScrollWidth > m.wrapClientWidth + 1) {
      const sticky = await page.evaluate(() => {
        const wrap = document.querySelector(".standings-wrap");
        wrap.scrollLeft = wrap.scrollWidth; // clamps to max
        const tr = document.querySelector(".standings-table tbody tr");
        const origin = wrap.getBoundingClientRect().left + parseFloat(getComputedStyle(wrap).borderLeftWidth || 0);
        return [...tr.children].slice(0, 4).map((c, i) => {
          const r = c.getBoundingClientRect();
          return { col: i, left: r.left - origin, right: r.right - origin };
        });
      });
      // Sticky cells must start flush at the scrollport and remain edge-to-edge: any drift means a
      // sticky box is sitting on top of a column it does not own.
      if (Math.abs(sticky[0].left) > EPS) {
        fail(label, "sticky-origin", { firstStickyLeft: +sticky[0].left.toFixed(1), expected: 0 });
      }
      for (let i = 0; i < sticky.length - 1; i++) {
        const gap = sticky[i + 1].left - sticky[i].right;
        if (Math.abs(gap) > EPS) {
          fail(label, "sticky-contiguity", {
            between: `${COLUMNS[i]} → ${COLUMNS[i + 1]}`, gapPx: +gap.toFixed(1),
          });
        }
      }
      await page.evaluate(() => { document.querySelector(".standings-wrap").scrollLeft = 0; });
    }

    // ── 8. ROW COLOUR — one continuous background across a zone row. ──
    if (m.zoneRow) {
      const samples = await sampleRowColors(page, m.zoneRow, m.wrap, m.wrapClientWidth);
      const ref = samples[0];
      const off = samples.filter(s =>
        Math.abs(s.rgb[0] - ref.rgb[0]) > COLOR_EPS ||
        Math.abs(s.rgb[1] - ref.rgb[1]) > COLOR_EPS ||
        Math.abs(s.rgb[2] - ref.rgb[2]) > COLOR_EPS);
      if (off.length) {
        fail(label, "row-status-background-discontinuous", {
          zone: m.zoneRow.zone, reference: ref, mismatchCount: off.length, examples: off.slice(0, 4),
        });
      }
    } else {
      fail(label, "no-zone-row", { note: "expected at least one G4/SA/Z4 row to verify row colour continuity" });
    }

    const before = findings.filter(f => f.viewport === label).length;
    if (before === 0) {
      console.log(`  ✓ ${label}: ${m.rowCount} rows, table ${Math.round(m.table.width)}px, ` +
        `team col ${Math.round(team.width)}px, columns contiguous + aligned, no page overflow`);
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const server = await startStaticServer(PORT, ROOT);
  const browser = await launchChromium();
  try {
    for (const vp of VIEWPORTS) await checkViewport(browser, vp);
  } finally {
    await browser.close();
    await server.stop();
  }
  if (findings.length === 0) {
    console.log("\n✓ ALL CHECKS PASSED — BR2026 standings layout sound at all 8 viewports");
    process.exit(0);
  }
  console.error(`\n✗ FAILED — ${findings.length} finding(s)`);
  process.exit(1);
}

main();
