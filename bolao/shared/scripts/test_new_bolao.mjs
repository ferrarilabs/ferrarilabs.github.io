#!/usr/bin/env node
// test_new_bolao.mjs — football-hardening checkpoint H test for the new-bolão generator.
//
// Run: node bolao/shared/scripts/test_new_bolao.mjs
//
// Generates into an isolated temp directory (--root=) — never touches the real bolao/ tree.
// No real emails, no Supabase writes, no network.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";
import { parseArgs, syncEspnTemplate } from "./new_bolao.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

// ── 1. parseArgs ──────────────────────────────────────────────────────────────────────────
{
  const a = parseArgs(["libertadores2027", "--competition-id=conmebol.libertadores", "--kind=standings"]);
  check("parseArgs: extracts appId/competitionId/kind", a.appId === "libertadores2027" && a.competitionId === "conmebol.libertadores" && a.kind === "standings", a);
  const b = parseArgs(["foo"]);
  check("parseArgs: kind defaults to scoreboard", b.kind === "scoreboard", b);
}

// ── 2. generated sync_espn.py imports the SHARED provider, doesn't reimplement it ───────────
{
  const src = syncEspnTemplate("testapp", "test.competition", "scoreboard");
  check("generated sync_espn.py imports the shared espn_provider (not a copy)", src.includes("import espn_provider as ep"), src.slice(0, 200));
  check("generated sync_espn.py calls ep.run_sync (shared driver, not custom fetch logic)", src.includes("ep.run_sync(CONFIG)"), null);
  check("generated sync_espn.py has zero raw urllib/requests calls (all fetch logic stays shared)", !/urllib\.request\.urlopen|requests\.get/.test(src), null);
}

// ── 3. Full CLI run: real scaffold into an isolated temp dir, verify file contents ──────────
{
  const tmpRoot = mkdtempSync(join(os.tmpdir(), "bolao-new-app-test-"));
  try {
    const out = execFileSync("node", [join(HERE, "new_bolao.mjs"), "libertadores2027", "--competition-id=conmebol.libertadores", `--root=${tmpRoot}`], { encoding: "utf8" });
    check("CLI run succeeds and reports the scaffolded path", out.includes("bolao/libertadores2027/"), out);

    const appDir = join(tmpRoot, "libertadores2027");
    check("scripts/sync_espn.py was created", existsSync(join(appDir, "scripts", "sync_espn.py")));
    check("data/.gitkeep was created", existsSync(join(appDir, "data", ".gitkeep")));
    check("QUICKSTART.md was created", existsSync(join(appDir, "QUICKSTART.md")));

    const syncContent = readFileSync(join(appDir, "scripts", "sync_espn.py"), "utf8");
    check("generated sync_espn.py embeds the given competition_id", syncContent.includes('"competition_id": "conmebol.libertadores"'), syncContent.slice(0, 300));

    const py = execFileSync("python3", ["-m", "py_compile", join(appDir, "scripts", "sync_espn.py")], { encoding: "utf8" });
    check("generated sync_espn.py is valid Python (py_compile succeeds)", true); // execFileSync throws on non-zero exit

    const quickstart = readFileSync(join(appDir, "QUICKSTART.md"), "utf8");
    check("QUICKSTART.md mentions audit_scoring.py (money-critical, must not be skipped)", quickstart.includes("audit_scoring.py"));
    check("QUICKSTART.md mentions the freshness guard wiring step", quickstart.includes("FreshnessGuard"));
    check("QUICKSTART.md mentions cachebust.mjs", quickstart.includes("cachebust.mjs"));

    // Refuses to overwrite an existing app directory.
    let refused = false;
    try {
      execFileSync("node", [join(HERE, "new_bolao.mjs"), "libertadores2027", `--root=${tmpRoot}`], { encoding: "utf8" });
    } catch (err) {
      refused = err.status !== 0 && /already exists/.test(err.stderr || "");
    }
    check("CLI refuses to overwrite an existing app directory", refused);

    // Rejects an invalid app-id.
    let rejectedBadId = false;
    try {
      execFileSync("node", [join(HERE, "new_bolao.mjs"), "Invalid-ID!", `--root=${tmpRoot}`], { encoding: "utf8" });
    } catch (err) {
      rejectedBadId = err.status !== 0;
    }
    check("CLI rejects an invalid app-id", rejectedBadId);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL NEW-BOLAO GENERATOR CHECKS PASSED");
process.exit(0);
