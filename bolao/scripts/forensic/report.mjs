/**
 * report.mjs — builds the navigable forensic-visual-report.html.
 * Pure string templating, no framework — same house style as the rest of this repo.
 */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STATUS_COLOR = {
  IDENTICAL: "#2fe56e", WITHIN_TOLERANCE: "#60a5fa", FUNCTIONALLY_JUSTIFIED: "#f59e0b",
  DIVERGENT: "#ff6b6b", "N/A": "#666",
};

function statusBadge(status) {
  return `<span class="badge" style="background:${STATUS_COLOR[status] || "#666"}22;color:${STATUS_COLOR[status] || "#999"};border:1px solid ${STATUS_COLOR[status] || "#666"}66">${esc(status)}</span>`;
}

function isMobile(vpLabel) {
  const w = parseInt(vpLabel, 10);
  return w > 0 && w < 768;
}

function buildComponentSection(comparisons, kindLabel) {
  return comparisons.map((c) => {
    const isGeometry = "geometry" in c;
    const propsObj = isGeometry ? c.geometry : c.properties;
    const rows = Object.entries(propsObj);
    const anyDivergent = rows.some(([, r]) => r.status === "DIVERGENT");
    const anyJustified = rows.some(([, r]) => r.status === "FUNCTIONALLY_JUSTIFIED");
    const isGames = ["games-section-title", "game-card", "game-date", "game-stage", "home-team", "away-team", "team-name", "team-logo", "game-score", "game-time", "game-status"].includes(c.component);
    const isRanking = !isGames;
    const classes = ["component-card"];
    if (anyDivergent) classes.push("has-divergent");
    if (anyJustified) classes.push("has-justified");
    if (!anyDivergent && !anyJustified) classes.push("all-clear");
    classes.push(isGames ? "cat-games" : "cat-ranking");

    const propRows = rows.map(([prop, r]) => {
      const vals = r.values;
      return `<tr class="prop-row status-${r.status.replace(/[^A-Z_]/g, "")}">
        <td class="prop-name">${esc(prop)}</td>
        <td>${vals.copa2026 === null || vals.copa2026 === undefined ? "<span class=\"muted\">—</span>" : esc(vals.copa2026)}</td>
        <td>${vals.br2026 === null || vals.br2026 === undefined ? "<span class=\"muted\">—</span>" : esc(vals.br2026)}</td>
        <td>${vals.cdb2026 === null || vals.cdb2026 === undefined ? "<span class=\"muted\">—</span>" : esc(vals.cdb2026)}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="reason">${r.reason ? esc(r.reason) : ""}</td>
      </tr>`;
    }).join("");

    return `<div class="${classes.join(" ")}" data-cat="${isGames ? "games" : "ranking"}" data-divergent="${anyDivergent}" data-justified="${anyJustified}">
      <h4>${esc(c.component)} <span class="state-tag">${esc(c.state)}</span> <span class="kind-tag">${kindLabel}</span></h4>
      <table>
        <thead><tr><th>Propriedade</th><th>Copa (golden master)</th><th>BR2026</th><th>CDB2026</th><th>Status</th><th>Motivo / Justificativa</th></tr></thead>
        <tbody>${propRows}</tbody>
      </table>
    </div>`;
  }).join("\n");
}

function buildMontageSection(montageEntries) {
  const byScreen = {};
  for (const m of montageEntries) {
    byScreen[m.screen] = byScreen[m.screen] || [];
    byScreen[m.screen].push(m);
  }
  return Object.entries(byScreen).map(([screen, entries]) => {
    const cards = entries.map((e) => {
      const mobile = isMobile(e.viewport);
      return `<div class="montage-card" data-viewport-class="${mobile ? "mobile" : "desktop"}">
        <div class="montage-label">${esc(screen)} — ${esc(e.viewport)}</div>
        <img src="side-by-side-montages/${esc(e.file)}" loading="lazy">
      </div>`;
    }).join("");
    return `<div class="montage-group"><h3>${esc(screen)}</h3><div class="montage-grid">${cards}</div></div>`;
  }).join("\n");
}

function buildPixelDiffSection(pixelDiffResults) {
  const rows = pixelDiffResults.map((r) => {
    const status = !r.comparable ? "N/A" : (r.ratio > 0.005 || !r.sameDimensions) ? "DIVERGENT" : "IDENTICAL";
    return `<tr>
      <td>${esc(r.component)}</td><td>${esc(r.state)}</td><td>${esc(r.app)}</td>
      <td>${r.comparable ? `${(r.ratio * 100).toFixed(3)}%` : "—"}</td>
      <td>${r.comparable ? (r.sameDimensions ? "sim" : "NÃO") : "—"}</td>
      <td>${statusBadge(status)}</td>
      <td>${r.diffImage ? `<a href="../${esc(r.diffImage)}" target="_blank">diff</a>` : (r.reason ? esc(r.reason) : "")}</td>
    </tr>`;
  }).join("");
  return `<table class="pixel-table">
    <thead><tr><th>Componente</th><th>Estado</th><th>App</th><th>% pixels diferentes</th><th>Mesmas dimensões</th><th>Status</th><th>Diff</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildReportHtml({ verdict, styleComparison, geometryComparison, pixelDiffResults, montageEntries, fixture, consoleErrors }) {
  const pass = verdict.verdict.includes("PASSED");
  const styleSection = buildComponentSection(styleComparison, "estilo computado");
  const geometrySection = buildComponentSection(geometryComparison, "geometria");
  const montageSection = buildMontageSection(montageEntries);
  const pixelSection = buildPixelDiffSection(pixelDiffResults);
  const totalConsoleErrors = Object.values(consoleErrors).flat();

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Auditoria Visual Forense — Jogos &amp; Ranking</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0d1417; color:#eef7ee; font-family:-apple-system,Inter,system-ui,sans-serif; margin:0; padding:0 0 60px; }
  header { padding:24px; background:#0a1013; border-bottom:1px solid #223; position:sticky; top:0; z-index:10; }
  h1 { margin:0 0 6px; font-size:22px; }
  .verdict { display:inline-block; padding:10px 18px; border-radius:8px; font-weight:800; font-size:16px; margin-top:8px; }
  .verdict.pass { background:#2fe56e22; color:#2fe56e; border:2px solid #2fe56e; }
  .verdict.fail { background:#ff6b6b22; color:#ff6b6b; border:2px solid #ff6b6b; }
  .counts { display:flex; gap:14px; margin-top:12px; flex-wrap:wrap; font-size:13px; }
  .count-chip { padding:4px 10px; border-radius:6px; background:#1a2226; }
  main { max-width:1400px; margin:0 auto; padding:20px; }
  section { margin-bottom:40px; }
  h2 { border-bottom:1px solid #223; padding-bottom:8px; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; position:sticky; top:110px; background:#0d1417; padding:8px 0; z-index:9; }
  .filters button { background:#1a2226; color:#eef7ee; border:1px solid #334; border-radius:6px; padding:6px 14px; cursor:pointer; font-size:13px; }
  .filters button.active { background:#2fe56e; color:#0d1417; font-weight:700; border-color:#2fe56e; }
  .component-card { background:#121a1e; border:1px solid #223; border-radius:8px; padding:14px; margin-bottom:14px; }
  .component-card.has-divergent { border-color:#ff6b6b88; }
  .component-card.has-justified:not(.has-divergent) { border-color:#f59e0b66; }
  h4 { margin:0 0 10px; font-size:14px; }
  .state-tag, .kind-tag { font-size:11px; color:#9ab; background:#1a2226; padding:2px 8px; border-radius:10px; margin-left:6px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { text-align:left; padding:5px 8px; border-bottom:1px solid #1a2226; }
  th { color:#9ab; font-weight:600; }
  .prop-name { font-family:ui-monospace,monospace; color:#cde; }
  .muted { color:#556; }
  .badge { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; white-space:nowrap; }
  .reason { color:#9ab; font-size:11px; max-width:420px; }
  .montage-grid { display:flex; flex-wrap:wrap; gap:16px; }
  .montage-card { flex:1 1 420px; max-width:480px; }
  .montage-label { font-size:12px; color:#9ab; margin-bottom:6px; }
  .montage-card img { width:100%; border:1px solid #223; border-radius:6px; }
  .pixel-table td, .pixel-table th { font-size:12px; }
  .hidden-by-filter { display:none !important; }
  .fixture-box { background:#121a1e; border:1px solid #223; border-radius:8px; padding:14px; font-size:12px; font-family:ui-monospace,monospace; white-space:pre-wrap; }
  .findings { background:#f59e0b11; border:1px solid #f59e0b55; border-radius:8px; padding:14px; margin-bottom:20px; }
  .findings h3 { margin-top:0; color:#f59e0b; }
</style>
</head>
<body>
<header>
  <h1>Auditoria Visual Forense — Jogos &amp; Ranking (Copa golden master)</h1>
  <div class="verdict ${pass ? "pass" : "fail"}">${esc(verdict.verdict)}</div>
  <div class="counts">
    <span class="count-chip">IDENTICAL: ${verdict.counts.IDENTICAL}</span>
    <span class="count-chip">WITHIN_TOLERANCE: ${verdict.counts.WITHIN_TOLERANCE}</span>
    <span class="count-chip">FUNCTIONALLY_JUSTIFIED: ${verdict.counts.FUNCTIONALLY_JUSTIFIED}</span>
    <span class="count-chip" style="color:#ff6b6b">DIVERGENT: ${verdict.counts.DIVERGENT}</span>
    <span class="count-chip">N/A: ${verdict.counts["N/A"]}</span>
    <span class="count-chip">Pixel-diff failures: ${verdict.pixelDiffFailureCount}</span>
    <span class="count-chip">Console errors: ${verdict.consoleErrorCount}</span>
  </div>
  <div class="filters">
    <button data-filter="all" class="active">Todos</button>
    <button data-filter="divergent">Divergent</button>
    <button data-filter="justified">Justified</button>
    <button data-filter="games">Games</button>
    <button data-filter="ranking">Ranking</button>
    <button data-filter="mobile">Mobile</button>
    <button data-filter="desktop">Desktop</button>
  </div>
</header>
<main>
  ${verdict.schemaProblems.length || verdict.unusedAllowlistEntries.length ? `<div class="findings"><h3>Problemas do ALLOWLIST</h3>
    ${verdict.schemaProblems.map((p) => `<div>✗ ${esc(p)}</div>`).join("")}
    ${verdict.unusedAllowlistEntries.map((e) => `<div>✗ entrada não utilizada: ${esc(e.key)} (apps: ${e.apps.join(",")}, approvedBy: ${esc(e.approvedBy)})</div>`).join("")}
  </div>` : ""}

  <div class="findings" style="background:#60a5fa11;border-color:#60a5fa55">
    <h3 style="color:#60a5fa">Metodologia — leitura correta dos achados abaixo</h3>
    <p>CDB2026's ida/volta format has no pre-existing container element around a leg's team names,
    date, or score the way Copa's <code>.game-team</code>/<code>.pill</code>/<code>.game-score</code>
    or BR2026's <code>.match-team</code>/<code>.game-time</code>/<code>.game-score-final</code> do
    -- this audit's own <code>data-visual-role</code> markers had to wrap that content in a bare,
    unstyled <code>&lt;span&gt;</code>/<code>&lt;b&gt;</code> to have anything to select at all.
    That bare wrapper's <b>container-level box-model properties</b> (<code>display</code>,
    <code>alignItems</code>/<code>justifyContent</code>/<code>gap</code>,
    <code>border*</code>, <code>padding*</code>) are therefore <b>not meaningful</b> for
    <code>home-team</code>/<code>away-team</code>/<code>game-date</code>/<code>game-time</code>/
    <code>game-score</code> in CDB2026 specifically -- they compare a real, styled element in
    Copa/BR2026 against an artifact of this harness's own marker placement, not a real design
    decision in CDB2026's CSS. Retrofitting CDB2026 with matching container classes would be a
    real visual change, out of scope for an audit.</p>
    <p><b>What stays fully valid</b>: <code>team-name</code>'s own typography (it IS a real,
    pre-existing class in all three apps -- <code>.team-name</code> in Copa/CDB2026,
    <code>.match-team-name</code> in BR2026) and <code>game-status</code> (real
    <code>.status-chip</code>/<code>.game-status</code> classes everywhere) are genuine,
    actionable findings, not artifacts.</p>
  </div>

  <section>
    <h2>Fixture canônico</h2>
    <div class="fixture-box">${esc(JSON.stringify(fixture, null, 2))}</div>
  </section>

  <section>
    <h2>Montagens lado a lado (Copa | BR2026 | CDB2026)</h2>
    ${montageSection}
  </section>

  <section>
    <h2>Pixel diff (referência: Copa)</h2>
    ${pixelSection}
  </section>

  <section>
    <h2>Comparação de estilo computado</h2>
    <div id="style-comparisons">${styleSection}</div>
  </section>

  <section>
    <h2>Comparação de geometria (getBoundingClientRect)</h2>
    <div id="geometry-comparisons">${geometrySection}</div>
  </section>

  <section>
    <h2>Console errors por app</h2>
    <div class="fixture-box">${totalConsoleErrors.length ? esc(JSON.stringify(consoleErrors, null, 2)) : "Nenhum console error em nenhum app."}</div>
  </section>
</main>
<script>
  const buttons = document.querySelectorAll(".filters button");
  const cards = document.querySelectorAll(".component-card");
  const montageCards = document.querySelectorAll(".montage-card");
  buttons.forEach(btn => btn.addEventListener("click", () => {
    buttons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const f = btn.dataset.filter;
    cards.forEach(c => {
      let show = true;
      if (f === "divergent") show = c.dataset.divergent === "true";
      else if (f === "justified") show = c.dataset.justified === "true";
      else if (f === "games") show = c.dataset.cat === "games";
      else if (f === "ranking") show = c.dataset.cat === "ranking";
      else if (f === "mobile" || f === "desktop") show = true; // viewport filter only affects montages
      c.classList.toggle("hidden-by-filter", !show);
    });
    montageCards.forEach(c => {
      let show = true;
      if (f === "mobile") show = c.dataset.viewportClass === "mobile";
      else if (f === "desktop") show = c.dataset.viewportClass === "desktop";
      else if (f === "divergent" || f === "justified" || f === "games" || f === "ranking") show = false;
      c.classList.toggle("hidden-by-filter", !show);
    });
  }));
</script>
</body>
</html>`;
}
