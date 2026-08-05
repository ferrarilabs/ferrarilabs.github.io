#!/usr/bin/env node
/**
 * new_bolao.mjs — scaffolds a new football-bolão app wired to the shared infrastructure built
 * across checkpoints C/D/G, instead of hand-copying an existing app's code (how copa2026/
 * br2026/cdb2026 were each originally built, independently, which is exactly why the "Vasco da
 * Gama"/"Athletico-PR" name-alias bugs, the direct-ESPN-fetch dependency, and the missing
 * zero-stale-cache policy each had to be fixed three separate times instead of once).
 *
 * Run:  node bolao/shared/scripts/new_bolao.mjs <app-id> --competition-id=<espn slug> [--kind=scoreboard|standings]
 * Example:
 *   node bolao/shared/scripts/new_bolao.mjs libertadores2027 --competition-id=conmebol.libertadores
 *
 * What this generates (all under bolao/<app-id>/):
 *   - scripts/sync_espn.py          — thin, declarative wrapper around
 *                                      bolao/shared/scripts/espn_provider.py (checkpoint C
 *                                      pattern — NOT a copy of the fetch/validate/normalize
 *                                      logic itself, that stays shared).
 *   - data/.gitkeep                 — sync_espn.py writes data/espn-normalized.json here.
 *   - QUICKSTART.md                 — what to do next (real team names/aliases, scoring rules,
 *                                      admin password hash, EmailJS keys, first cachebust run).
 *
 * What this intentionally does NOT generate (and why): index.html, js/app.js, js/config.js,
 * js/i18n.js, js/data.js. Per the platform's own golden-master rule (CLAUDE.md: "A Copa do
 * Mundo 2026 é a referência visual canônica... BR2026 e CDB2026 devem copiar seus padrões
 * visuais, não sua lógica de torneio") every app's VISUAL layer is copied by hand from
 * bolao/copa2026/ (tokens/structure/CSS), and every app's TOURNAMENT LOGIC (scoring formula,
 * bracket/table format, tiebreak cascade) is genuinely bespoke per tournament — auto-generating
 * either would either violate the golden-master rule (visual drift) or fabricate business logic
 * a human must actually decide (scoring). This generator's job is narrower and safer: make sure
 * the OPERATIONAL plumbing (ESPN sync, notification outbox wiring, cache-bust, freshness guard)
 * is correct and shared from day one, not reimplemented a fourth time.
 *
 * See QUICKSTART.md (generated) for the full manual steps this tool does not automate.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOLAO_ROOT = join(HERE, "..", ".."); // .../bolao

function parseArgs(argv) {
  const appId = argv.find((a) => !a.startsWith("--"));
  const competitionId = argv.find((a) => a.startsWith("--competition-id="))?.slice("--competition-id=".length);
  const kind = argv.find((a) => a.startsWith("--kind="))?.slice("--kind=".length) || "scoreboard";
  const root = argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) || BOLAO_ROOT;
  return { appId, competitionId, kind, root };
}

function syncEspnTemplate(appId, competitionId, kind) {
  return `#!/usr/bin/env python3
"""
sync_espn.py — ${appId} thin wrapper around the shared bolao/shared/scripts/espn_provider.py.

Run: python3 bolao/${appId}/scripts/sync_espn.py

Declarative only — see bolao/cdb2026/scripts/sync_espn.py for the reference pattern this was
generated from (football-hardening checkpoint C/H). All fetch/validate/normalize/atomic-write
logic lives in the shared provider; this file defines ONLY config.

TODO before first real use:
  1. Confirm competition_id/source_url actually match this competition's real ESPN slug (this
     was generated from a command-line flag, not verified against a live ESPN response).
  2. Add any team-name aliases ESPN uses that differ from this app's own curated team names —
     see bolao/cdb2026/scripts/sync_espn.py's ALIASES dict and
     docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md section 1 for why this matters (two real
     production incidents from skipping this step).
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import espn_provider as ep  # noqa: E402

CONFIG = {
    "competition_id": "${competitionId || "TODO-espn-competition-slug"}",
    "provider": "espn",
    "kind": "${kind}",
    "source_url": "https://site.api.espn.com/apis/site/v2/sports/soccer/${competitionId || "TODO"}/scoreboard?dates=20270101-20271231&limit=500",
    "output_path": str(HERE.parent / "data" / "espn-normalized.json"),
    "aliases": {},  # TODO: fill in as real name mismatches are found (see docstring above)
}

if __name__ == "__main__":
    outcome = ep.run_sync(CONFIG)
    print(f"[${appId}] sync outcome: wrote={outcome.wrote} stale={outcome.stale} reason={outcome.reason}")
    if outcome.problems:
        print(f"[${appId}] problems: {outcome.problems}")
    sys.exit(0)
`;
}

function quickstartTemplate(appId, competitionId) {
  return `# Quickstart — bolao/${appId}/

Generated by \`bolao/shared/scripts/new_bolao.mjs\`. This scaffolds the OPERATIONAL plumbing
only (ESPN sync wired to the shared provider) — see the header comment in
\`bolao/shared/scripts/new_bolao.mjs\` for why the visual layer and tournament logic are
deliberately NOT auto-generated.

## What already exists

- \`bolao/${appId}/scripts/sync_espn.py\` — wired to \`bolao/shared/scripts/espn_provider.py\`
  (checkpoint C). Run \`python3 bolao/${appId}/scripts/sync_espn.py\` once you've confirmed the
  \`competition_id\`/\`source_url\` in that file are correct.
- \`bolao/${appId}/data/\` — where the normalized ESPN snapshot lands.

## Manual steps still required (in order)

1. **Visual layer** — copy \`bolao/copa2026/index.html\`, adapt \`js/config.js\`/\`js/i18n.js\`/
   \`js/data.js\`/\`js/app.js\` from the closest-matching existing app (copa2026 for a
   bracket/knockout format, cdb2026 for a two-leg-tie knockout, br2026 for a league table).
   Per the platform's golden-master rule, reproduce Copa2026's CSS tokens/structure/spacing —
   never invent new visual patterns. See \`docs/bolao/DESIGN_SYSTEM.md\`.
2. **Tournament logic** — scoring formula, bracket/table structure, tiebreak cascade are
   genuinely bespoke per tournament; write and get Eduardo's explicit sign-off before any
   money-affecting formula goes live (see CLAUDE.md "Nunca alterar scoring... sem autorização
   explícita do Eduardo").
3. **\`audit_scoring.py\`** — every app has one (\`bolao/{copa2026,br2026,cdb2026}/scripts/
   audit_scoring.py\`); write this app's equivalent BEFORE any real money is collected. This is
   non-negotiable per CLAUDE.md's standing rule from the July 2026 incident.
4. **Cache-busting** — add \`"${appId}"\` to \`APPS\` in \`bolao/scripts/cachebust.mjs\`, then run
   \`node bolao/scripts/cachebust.mjs write --app=${appId}\` to generate the initial \`?v=\` tags
   and \`build-version.json\`.
5. **Freshness guard** — add \`<meta name="build-id" content="...">\` (from step 4's
   build-version.json) and \`<script src="../shared/js/freshness-guard.js"></script>\` as the
   FIRST script in \`<head>\`, before any app CSS/JS. Wire \`window.FreshnessGuard.state.fresh
   === false\` into this app's \`guardAdmin()\`, same pattern as the other three apps.
6. **Notification outbox** (only if this app sends result emails) — wire
   \`bolao/shared/scripts/notification_outbox.py\` (Python) or \`.mjs\` (Node) into the send
   script's per-recipient loop, same pattern as \`bolao/cdb2026/scripts/send_result_email.py\`'s
   \`_send_to_all()\`. See \`bolao/cdb2026/scripts/test_notification_bridge.py\` for the test
   pattern to copy.
7. **Admin password hash**, **EmailJS keys**, **Supabase table/RLS** — see the "Bolão app —
   quick reference" section of the repo's \`CLAUDE.md\` for the exact mechanism each of the
   three existing apps uses; none of these are auto-generated (secrets/config, not code).
8. **Platform governance** — read \`docs/bolao/PLATFORM_GOVERNANCE.md\` and
   \`docs/bolao/CONSISTENCY_MATRIX.md\` before considering this app done; register it in both.

## Do not skip

Per \`docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md\`, the reason this generator exists at all:
every one of the three original apps independently reinvented (and independently bugged) the
same ESPN-fetch/name-aliasing/cache-freshness plumbing. Steps 3-6 above are exactly the parts
this generator's scaffold keeps you from having to reinvent — use the shared modules, don't
copy their logic into a fourth per-app implementation.
`;
}

function main() {
  const { appId, competitionId, kind, root } = parseArgs(process.argv.slice(2));
  if (!appId) {
    console.error("Usage: node bolao/shared/scripts/new_bolao.mjs <app-id> --competition-id=<espn-slug> [--kind=scoreboard|standings] [--root=<path>]");
    process.exit(1);
  }
  if (!/^[a-z][a-z0-9]*$/.test(appId)) {
    console.error(`✗ invalid app-id "${appId}" — must be lowercase alphanumeric, starting with a letter (e.g. "libertadores2027")`);
    process.exit(1);
  }
  const appRoot = join(root, appId);
  if (existsSync(appRoot)) {
    console.error(`✗ bolao/${appId}/ already exists — refusing to overwrite. Remove it first if you really want to regenerate.`);
    process.exit(1);
  }

  mkdirSync(join(appRoot, "scripts"), { recursive: true });
  mkdirSync(join(appRoot, "data"), { recursive: true });
  writeFileSync(join(appRoot, "scripts", "sync_espn.py"), syncEspnTemplate(appId, competitionId, kind));
  writeFileSync(join(appRoot, "data", ".gitkeep"), "");
  writeFileSync(join(appRoot, "QUICKSTART.md"), quickstartTemplate(appId, competitionId));

  console.log(`✓ Scaffolded bolao/${appId}/`);
  console.log(`  - scripts/sync_espn.py (wired to the shared ESPN provider)`);
  console.log(`  - data/.gitkeep`);
  console.log(`  - QUICKSTART.md (read this next — lists every manual step still required)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

export { parseArgs, syncEspnTemplate, quickstartTemplate };
