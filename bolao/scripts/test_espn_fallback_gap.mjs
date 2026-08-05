#!/usr/bin/env node
/**
 * test_espn_fallback_gap.mjs — cross-app ESPN direct-fetch dependency regression suite
 * (football-hardening checkpoint B).
 *
 * Run:  node bolao/scripts/test_espn_fallback_gap.mjs
 *
 * PURPOSE: written RED, against the current apps, to prove with real static assertions (not a
 * guess) that all three bolão apps depend on direct, unvalidated, CORS-exposed browser->ESPN
 * fetches for live functionality, with no server-side/versioned-JSON fallback source and no
 * explicit UI error state distinct from the initial loading state — see
 * docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md section 1.
 *
 * This is a structural/static check (source inspection), not a live network test, because:
 *  - we must not depend on network access in CI/local runs;
 *  - the bug class here is architectural absence (no fallback code path exists), which a runtime
 *    test can't prove any more convincingly than reading the source for the missing branch.
 *
 * Each check should be updated to assert the NEW passing behaviour once checkpoint C (server-side
 * provider + normalized JSON) and checkpoint G (explicit error state) land — do not delete this
 * file after the fix, turn it into the permanent regression guard.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail) console.error(`    ${detail}`);
}

const apps = [
  { id: "copa2026", jsDir: "bolao/copa2026/js", appFile: "app.js" },
  { id: "br2026",   jsDir: "bolao/br2026/js",   appFile: "app.js" },
  { id: "cdb2026",  jsDir: "bolao/cdb2026/js",  appFile: "app.js" },
];

for (const app of apps) {
  const appPath = join(ROOT, app.jsDir, app.appFile);
  const src = readFileSync(appPath, "utf8");

  // 1. [EXPECTED RED pre-fix] direct browser->ESPN fetch present in client JS.
  const hasDirectEspnFetch = /fetch\(\s*[`"']?https?:\/\/(site|sports\.core)\.api\.espn\.com/.test(src)
    || /C\.espn\?\.\w+/.test(src) || /C\.espn\.\w+Url/.test(src);
  check(
    `${app.id}: [EXPECTED RED pre-fix] client JS still calls ESPN directly (no server-side provider layer yet)`,
    !hasDirectEspnFetch,
    `${app.id}/js/app.js still contains a direct ESPN fetch or C.espn.*Url usage — expected once checkpoint C lands`
  );

  // 2. [EXPECTED RED pre-fix] no versioned, checked-in normalized JSON data file to read instead.
  const normalizedDataPath = join(ROOT, "bolao", app.id, "data", "espn-normalized.json");
  check(
    `${app.id}: [EXPECTED RED pre-fix] no checked-in normalized data file at bolao/${app.id}/data/espn-normalized.json yet`,
    !existsSync(normalizedDataPath),
    `expected to NOT exist yet (checkpoint C creates it) — if it exists, this check should now flip to asserting presence + shape`
  );
}

// 3. BR2026-specific: the exact stuck-spinner bug class the task warns about. renderGamesSection()
// shows the SAME "loading" text (i18n key gamesLoading) whenever `_schedule` is empty, with no
// separate branch for "fetch failed / will never succeed" - confirmed by reading
// bolao/br2026/js/app.js's renderGamesSection() (~line 2008-2014) and index.html's static
// placeholder (~line 179), both using the exact same "Carregando calendário..." string with no
// error-state i18n key (e.g. gamesError) referenced anywhere in app.js.
{
  const brApp = readFileSync(join(ROOT, "bolao/br2026/js/app.js"), "utf8");
  const brI18n = readFileSync(join(ROOT, "bolao/br2026/js/i18n.js"), "utf8");
  const hasErrorStateKey = /gamesError|scheduleError|espnError|dataUnavailable|sourceUnavailable/.test(brI18n);
  const errorStateWiredInRender = /renderGamesSection[\s\S]{0,600}(gamesError|scheduleError|espnError|dataUnavailable|sourceUnavailable)/.test(brApp);
  check(
    "br2026: [EXPECTED RED pre-fix] no explicit 'data source unavailable' error-state i18n key exists yet",
    !hasErrorStateKey,
    "expected no gamesError/scheduleError/espnError/dataUnavailable key yet — checkpoint G adds one"
  );
  check(
    "br2026: [EXPECTED RED pre-fix] renderGamesSection() has no branch distinguishing 'loading' from 'permanently failed'",
    !errorStateWiredInRender,
    "renderGamesSection() only ever shows the loading string when _schedule is empty — a permanently failed fetch looks identical to a page that just opened"
  );
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED — this is the RED baseline for checkpoint B (expected pre-fix)`);
  process.exit(1);
}
console.log("✓ ALL ESPN-FALLBACK CHECKS PASSED (post-fix state — checkpoints C/G complete)");
process.exit(0);
