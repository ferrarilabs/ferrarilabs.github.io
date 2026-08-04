/**
 * check_cachebust.mjs — CDB2026 cache-bust staleness guard (Fase 2.1 §5).
 *
 * Run:  node bolao/cdb2026/scripts/check_cachebust.mjs [--write]
 *
 * Why this exists: `bolao/cdb2026/index.html`'s `<script src="js/app.js?v=XXXX">` query params
 * exist so a browser/CDN cache that already has an old `app.js` under that exact URL is forced
 * to refetch when the content changes (a URL with a query string it has never seen is always a
 * cache miss). If the tag is bumped by hand (a commit hash, a version string) it is trivially
 * possible to edit a critical file and forget to bump the tag — the deploy looks fine, the file
 * changed on the server, but every browser/CDN edge that already cached the old URL keeps
 * serving the OLD file forever (or until its own cache TTL expires), because the URL never
 * changed. Found on this branch on 2026-08: `?v=58d393d` predates every Fase 1/2/2.1 change to
 * app.js/config.js/data.js/i18n.js/styles.css.
 *
 * PR120-final review item 2 (2026-08): this file used to define its OWN copy of the tag-hash and
 * regex logic, duplicated (and briefly incompatible) with `.github/workflows/sync_version.yml`,
 * which independently used `git rev-parse --short HEAD` as the tag — a completely different
 * value than the content hash this file computed, so a workflow-applied tag would immediately
 * fail this file's own "is it stale" check. Fixed: this file is now a thin CDB2026-scoped CLI
 * wrapper around the shared, single source of truth at `bolao/scripts/cachebust.mjs` — every
 * function below is a straight re-export, not a re-implementation, and the CLI just calls
 * `checkApp("cdb2026", { write })` from that module. `sync_version.yml` calls the SAME shared
 * module directly (`node bolao/scripts/cachebust.mjs write`) for all three bolão apps, so there
 * is exactly one place the tag is computed and exactly one place `?v=` is written — see that
 * file's header comment and `bolao/scripts/cachebust.integration.test.mjs` for the end-to-end
 * proof.
 *
 * Kept as its own file (not deleted) because: (1) `node bolao/cdb2026/scripts/check_cachebust.mjs`
 * is the exact command named in this branch's regression checklist and in the PR120 review
 * package's acceptance criteria — removing it would break that contract for no benefit; (2) the
 * existing unit test suite (`check_cachebust.test.mjs`) imports `tagRegex`/`currentTags`/
 * `rewriteTags` from this exact path — re-exporting keeps that suite green without editing it.
 *
 * No dependencies beyond Node's stdlib (transitively, via the shared module). Exit code 0 = tag
 * matches content, 1 = stale (must be regenerated with --write before any deploy).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  tagRegex, currentTags, rewriteTags, computeTagFromFiles, checkApp,
} from "../../scripts/cachebust.mjs";

const APP = "cdb2026";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOLAO_ROOT = join(ROOT, ".."); // .../bolao

function main() {
  const write = process.argv.includes("--write") || process.argv.includes("write");
  const result = checkApp(APP, { write, bolaoRoot: BOLAO_ROOT });

  if (result.ok) {
    const verb = result.wrote ? "written and verified" : "up to date";
    console.log(`✓ cache-bust ${verb} (${result.expected}) — matches content of all 5 critical files`);
    return 0;
  }

  if (write) {
    console.error(`✗ --write FAILED post-write verification — after writing and re-reading index.html from disk, these assets still don't carry tag ${result.expected}: ${result.staleFiles.join(", ")}`);
    for (const f of result.staleFiles) console.error(`  ${f}: has ${result.found[f] ?? "(no ?v= found)"}`);
    return 1;
  }

  console.error(`✗ CACHE-BUST STALE — index.html would serve old cached files for: ${result.staleFiles.join(", ")}`);
  console.error(`  expected tag (hash of current file contents): ${result.expected}`);
  for (const f of result.staleFiles) console.error(`  ${f}: index.html has ${result.found[f] ?? "(no ?v= found)"}`);
  console.error(`  Fix: node bolao/cdb2026/scripts/check_cachebust.mjs --write`);
  return 1;
}

// Re-exported for the test suite (check_cachebust.test.mjs) — pure functions, no I/O, so they
// can be unit-tested against synthetic HTML fixtures without touching the real index.html. These
// now come straight from bolao/scripts/cachebust.mjs (see file header) — not redefined here.
export { tagRegex, currentTags, rewriteTags, computeTagFromFiles };

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
