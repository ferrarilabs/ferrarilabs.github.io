/**
 * check_manifest.mjs — visual evidence manifest validator (Fase 2.2 §15/§18).
 *
 * Run:  node bolao/cdb2026/scripts/visual/check_manifest.mjs
 *
 * Reads docs/bolao/evidence/visual/manifest.json (produced by capture_evidence.mjs) and fails if
 * any record is internally inconsistent or reports a real problem:
 *   - captured=true but requestedSection resolved to a different actualSection than expected
 *   - captured=true but the screenshot file referenced doesn't exist on disk
 *   - captured=true but has unclassified console/page errors
 *   - captured=true but horizontalOverflow=true
 *   - captured=true but overlaps is non-empty
 *   - status="failed" anywhere (a failed record means capture_evidence.mjs itself already found
 *     a real problem — this validator's job is to make that failure visible/blocking, not to
 *     silently accept whatever the manifest says)
 *
 * Exit 0 = manifest is clean. Exit 1 = one or more violations (full detail printed).
 */
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MANIFEST_PATH = join(ROOT, "docs", "bolao", "evidence", "visual", "manifest.json");

// Maps each app's section label -> the data-section id the label is supposed to resolve to,
// mirroring APPS.<app>.sections in capture_evidence.mjs. Used to catch the exact class of bug
// this manifest exists to prevent (screenshot named for section X actually showing section Y).
const EXPECTED_ACTUAL_SECTION = {
  Palpites: "entry", Ranking: "ranking", Jogos: "games", Pagamento: "payment",
  Regras: "rules", Admin: "admin",
};

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`✗ Manifest not found at ${MANIFEST_PATH} — run capture_evidence.mjs first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const violations = [];

  for (const r of manifest) {
    const tag = `${r.application}/${r.requestedSection}@${r.viewport?.width}x${r.viewport?.height}`;

    if (r.status === "failed") {
      violations.push({ tag, reason: `status=failed: ${r.reason || "(no reason recorded)"}` });
      continue;
    }

    if (!r.captured) continue; // unavailable/notApplicable: nothing further to validate

    const expected = EXPECTED_ACTUAL_SECTION[r.requestedSection];
    if (expected && r.actualSection !== expected) {
      violations.push({ tag, reason: `captured=true but actualSection="${r.actualSection}" != expected "${expected}"` });
    }
    if (!r.screenshot || !existsSync(join(ROOT, "docs", "bolao", "evidence", "visual", r.application, r.screenshot))) {
      violations.push({ tag, reason: `captured=true but screenshot file missing: ${r.screenshot || "(no filename recorded)"}` });
    }
    const unclassified = [...(r.consoleErrors || []), ...(r.pageErrors || [])];
    if (unclassified.length) {
      violations.push({ tag, reason: `captured=true but has ${unclassified.length} unclassified error(s): ${JSON.stringify(unclassified).slice(0, 200)}` });
    }
    if (r.horizontalOverflow) {
      violations.push({ tag, reason: "captured=true but horizontalOverflow=true" });
    }
    if (Array.isArray(r.overlaps) && r.overlaps.length) {
      violations.push({ tag, reason: `captured=true but overlaps is non-empty (${r.overlaps.length} finding(s))` });
    }
  }

  const counts = manifest.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});
  console.log(`Manifest records: ${manifest.length} — captured=${counts.captured || 0} unavailable=${counts.unavailable || 0} notApplicable=${counts.notApplicable || 0} failed=${counts.failed || 0}`);

  if (violations.length) {
    console.error(`\n✗ ${violations.length} manifest violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v.tag}: ${v.reason}`);
    process.exit(1);
  }
  console.log("✓ ALL CHECKS PASSED — manifest is internally consistent, no failed/inconsistent records");
  process.exit(0);
}

main();
