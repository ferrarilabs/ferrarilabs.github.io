#!/usr/bin/env node
/**
 * test_espn_fallback_gap.mjs — cross-app ESPN direct-fetch dependency regression suite
 * (football-hardening checkpoint B -> now GREEN after checkpoint C2).
 *
 * Run:  node bolao/scripts/test_espn_fallback_gap.mjs
 *
 * HISTORY: written RED against the pre-checkpoint-C2 apps (see git history / checkpoint B commit
 * 51dd9a7) to prove with real static assertions that all three bolão apps depended on direct,
 * unvalidated, CORS-exposed browser->ESPN fetches with no server-side/versioned-JSON fallback and
 * no explicit UI error state — see docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md section 1.
 *
 * Checkpoint C2 (bolao/shared/scripts/espn_provider.py + per-app sync_espn.py wrappers +
 * frontend migration) closed that gap. This file is now the PERMANENT regression guard —
 * flipped to assert the fixed state, per its own original instruction to do so once the fix
 * landed. A future regression that reintroduces a direct browser->ESPN call must fail this.
 *
 * Static/structural checks (source inspection), not live network tests, because:
 *  - we must not depend on network access in CI/local runs;
 *  - "no direct ESPN call exists" is an architectural absence, provable by grepping the source.
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

let totalDirectEspnHits = 0;

for (const app of apps) {
  const appPath = join(ROOT, app.jsDir, app.appFile);
  const src = readFileSync(appPath, "utf8");

  // 1. No direct browser->ESPN fetch anywhere in client JS. C.espn.*Url usage is still allowed —
  // it now points at a local, same-origin normalized JSON file, not at ESPN — so the real check
  // is a literal ESPN hostname, never a raw "site.api.espn.com"/"sports.core.api.espn.com" URL.
  const directEspnHits = (src.match(/(site|sports\.core)\.api\.espn\.com/g) || []).length;
  totalDirectEspnHits += directEspnHits;
  check(
    `${app.id}: zero direct browser->ESPN calls in client JS (checkpoint C2)`,
    directEspnHits === 0,
    `${app.id}/js/app.js still contains ${directEspnHits} literal ESPN hostname reference(s)`
  );

  // 2. A checked-in normalized JSON snapshot exists with the required contract shape.
  const normalizedDataPath = join(ROOT, "bolao", app.id, "data", "espn-normalized.json");
  const exists = existsSync(normalizedDataPath);
  check(
    `${app.id}: normalized snapshot exists at bolao/${app.id}/data/espn-normalized.json`,
    exists,
    `expected bolao/sync_espn.py to have written this file`
  );
  if (exists) {
    const snap = JSON.parse(readFileSync(normalizedDataPath, "utf8"));
    const required = ["schemaVersion", "competitionId", "generatedAt", "sourceUpdatedAt", "stale", "staleReason", "provider", "payloadHash", "matches"];
    const missing = required.filter(k => !(k in snap));
    check(
      `${app.id}: normalized snapshot has all required contract keys`,
      missing.length === 0,
      `missing keys: ${missing.join(", ")}`
    );
  }
}

check(
  "cross-app: zero total direct ESPN fetch call sites (was 10 pre-checkpoint-C2: 4 copa2026 + 4 br2026 + 2 cdb2026)",
  totalDirectEspnHits === 0,
  `found ${totalDirectEspnHits} literal ESPN hostname references across all three apps`
);

// BR2026-specific: the exact stuck-spinner bug class this task exists to prevent.
// renderGamesSection() must now have a branch distinguishing "loading" from "permanently failed",
// wired to a real error-state i18n key, distinct from gamesLoading.
{
  const brApp = readFileSync(join(ROOT, "bolao/br2026/js/app.js"), "utf8");
  const brI18n = readFileSync(join(ROOT, "bolao/br2026/js/i18n.js"), "utf8");
  const hasErrorStateKey = /gamesError\s*:/.test(brI18n);
  const errorStateWiredInRender = /function renderGamesSection[\s\S]{0,800}_dataSourceError[\s\S]{0,200}gamesError/.test(brApp);
  check(
    "br2026: explicit 'gamesError' i18n key exists, distinct from gamesLoading",
    hasErrorStateKey,
    "expected a gamesError key in js/i18n.js"
  );
  check(
    "br2026: renderGamesSection() has a real branch distinguishing loading from permanently-failed (_dataSourceError)",
    errorStateWiredInRender,
    "renderGamesSection() must check _dataSourceError and render t('gamesError'), not just t('gamesLoading'), when _schedule is empty"
  );
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL ESPN-FALLBACK CHECKS PASSED (post-checkpoint-C2 state)");
process.exit(0);
