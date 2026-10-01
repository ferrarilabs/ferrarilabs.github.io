# Current public exposure (before this change)

Evidence date 2026-10-01, baseline `origin/main` = `d6bf335d`. No secret or participant value is reproduced here.

## How production was built

`.github/workflows/deploy-pages.yml` ran `rsync -a ./ _site/` excluding only `.git/`, `.github/`, `_site/`,
`node_modules/`, `__pycache__/`, `*.pyc`. **Everything else tracked in the repository was served by GitHub Pages**:
1,299 of 1,339 tracked files (everything except `.github/`). Making the repository private would NOT have made any of
it private: Pages publishes the artifact, not the repository.

## What was reachable on `www.ferrarilabs.com` that should not be

| Area | Files published | Class | Notes |
|---|---:|---|---|
| `docs/` | 405 (~93 MB) | INTERNAL_DOCUMENTATION | architecture, security reports, QA, incident reviews, email-preview evidence |
| `scripts/` | 189 | OPERATIONS_PRIVATE | audit gates, PII detectors, sentinel, DB tooling |
| `supabase/` | 103 | OPERATIONS_PRIVATE | migrations, Edge Function source, `config.toml` |
| `workers/` | 14 | OPERATIONS_PRIVATE | Cloudflare Worker source |
| `bolao/scripts/`, `bolao/*/scripts/`, `bolao/shared/scripts/`, `bolao/shared/sql/`, `bolao/shared/safety/`, `bolao/shared/schemas/` | ~400 | OPERATIONS_PRIVATE | Python/Node senders, SQL, safety registries |
| `.claude/`, `CLAUDE.md`, `CHATGPT.md`, `.githooks/`, `memory/`, `model/` | ~30 | AI/INTERNAL | agent instructions, project memory |
| `bolao/loterias/powerball/email-previews/`, `logs/`, `scripts/email/outbox.json`, `.htaccess`, `debug.html` | ~25 | SENSITIVE_OR_PII_RISK | rendered participant emails (greeting is generic), a run log, an outbox ledger of the operator's own address, a debug page |
| `bolao/loterias/config/lottery_{ledger,results}.jsonl`, `lottery_policy.json` | 3 | OPERATIONS_PRIVATE | pool ledger / results history (only `lottery_status.json` is read by the browser) |
| `bolao/*/CHANGELOG.md`, `README*`, `bolao/*/docs/`, `data/round_manifest.json`, `data/quartas-draw-2026.json`, `bolao/copa2026/preview/` | ~60 | INTERNAL | not referenced by any browser path |
| root `README.md`, `package.json`, `package-lock.json` | 3 | BUILD_ONLY | |

Static scan (the repo's own `scripts/pii_detectors.mjs` + token/path rules) over the files that are no longer published
found: one GitHub-token-shaped string (test fixture), 18 files with email-address matches in tooling, 4 files with
local filesystem paths, 5 links into the source repository, and no private keys or privileged JWTs. Counts only; values
were not printed. Whether any of this was fetched by third parties cannot be determined from the repository.

## Deliberately public (unchanged)

Corporate pages (`/`, language variants, `/insights.html`, `/financial-crimes/`, `/small-business/`), `styles.css`,
`assets/`, `sitemap.xml`, `CNAME`, all three Bolão apps' runtime (`index.html`, `css/`, `js/`, `assets/`, `data/*`
used by the browser), `bolao/shared/{css,js,data}`, Copa audit pages and redirect stubs, the three service workers,
Powerball app + `lottery_status.json` + `data/public_projection.generated.json`, and
`bolao/loterias/powerball/tickets/*/{manifest.json,tickets.csv,tickets.pdf}` (linked from participant emails).

## Public by design but worth Eduardo's attention (not changed here)

- `bolao/loterias/powerball/js/data.js` renders real Powerball ticket serials (and `tickets/*` repeat them). This is a
  recorded operator decision (`DECLARED_EXPOSURES` in `scripts/pii_detectors.mjs`). Privatizing the repo does not
  change it, because the *site* serves it.
- Each app's `js/config.js` ships the public Supabase anon key, EmailJS public key, payment handles and the admin password
  SHA-256 hash (documented in `docs/bolao/SECURITY.md`). The artifact gate accepts `role=anon` JWTs and rejects privileged ones.
- Several pages declare `<link rel="canonical">` to `ferrarilabs.github.io` (301s to www). Pre-existing; not touched.

## Removed from the public site (URL behaviour change)

`/bolao/loterias/powerball/debug.html` (debug dump, unlinked) and `/bolao/copa2026/preview/` (noindex test page of a concluded
tournament, unlinked) now return 404. Everything else that browsers or emails load is preserved path-for-path.
