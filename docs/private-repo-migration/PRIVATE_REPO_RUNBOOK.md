# Runbook: public → private repository (`ferrarilabs/ferrarilabs.github.io`)

**Status of this document: prepared, NOT executed. Nothing here has been run. Only Eduardo authorizes the visibility change.**
Companion reports in this folder: `CURRENT_PUBLIC_EXPOSURE.md`, `PRIVATE_DEPENDENCY_AUDIT.md`, `ACTIONS_PRIVATE_REPO_AUDIT.md`,
`WORKER_TOKEN_AUDIT.md`, `READINESS_REPORT.md`.

## 0. Preconditions (all must be true — today two are NOT)

| # | Precondition | Status |
|---|---|---|
| P1 | This branch merged to `main` and the first deploy through the new pipeline observed healthy (section 3) | pending merge (not done by the agent) |
| P2 | **Account plan verified** in Settings → Billing and plans. The owner is a *personal* account. Pages from a private repo needs Pro or higher (per GitHub plans docs); on Free, flipping to private is expected to unpublish `www.ferrarilabs.com` | **NOT VERIFIED — BLOCKER** (API/billing blocked in the agent session) |
| P3 | Actions budget decided. Observed ~12,000 min/month vs 2,000 (Free) / 3,000 (Pro). ~8,640 of it is the Cloudflare Worker dispatching `live_cache_producer` every 5 min | **BLOCKER until decided** (see Actions audit §4) |
| P4 | Worker PAT `GH_DISPATCH_TOKEN` verified: fine-grained, repo `ferrarilabs/ferrarilabs.github.io` selected, `Actions: write`, not expired | NOT VERIFIED (external console) |
| P5 | Supabase GitHub integration check (Supabase dashboard → Integrations → GitHub): connected to this repo; note current `x-deploy-sha` of the live-football function | NOT VERIFIED |
| P6 | Eduardo accepts that history, forks and clones made while public remain public (section 8) | pending |

## 1. Before the visibility change

1. `git fetch`; confirm `main` contains the allowlist build, gate, and the `deploy-pages.yml` change; `npm run check` green.
2. Locally: `npm run check:public-artifact` and `PLAYWRIGHT_CHROMIUM_PATH=... node scripts/smoke-public-artifact.mjs --dir _site`.
3. Record baselines: `curl -s https://www.ferrarilabs.com/deployment-meta.json`; `curl -sI https://<project>.supabase.co/functions/v1/live-football | grep -i x-deploy-sha`;
   screenshot Settings → Pages (source = GitHub Actions, custom domain, Enforce HTTPS).
4. Decide the Actions plan (P3) and apply it first (e.g. move/trim the 5-min dispatch; add a payment method + spending limit consciously).
5. Choose a low-traffic window (no live matches, no draw, no pending result emails).

## 2. The visibility change (document only — DO NOT run from automation)

UI: repo → Settings → General → Danger Zone → **Change repository visibility → Make private**.
CLI equivalent: `gh repo edit ferrarilabs/ferrarilabs.github.io --visibility private --accept-visibility-change-consequences`.

## 3. Immediately after (first 15 minutes)

1. Settings → Pages: still shows the site published, custom domain `www.ferrarilabs.com` intact, HTTPS enforced.
2. Trigger the deploy explicitly: `gh workflow run "Deploy GitHub Pages" --ref main`; watch it finish (build → gate → upload → deploy).
   Compare live `deployment-meta.json` `gitSha` to `git rev-parse origin/main`.
3. Actions: Settings → Actions still enabled; run one cheap workflow (`workflow_dispatch` of `live_pipeline_monitor`) and confirm it is not "blocked: quota".
4. Worker: wait ≤5 min; `live_cache_producer` runs must keep appearing (dispatch http 204). A `RECUSADO dispatch http 404` in Worker logs = PAT lacks access to the (now private) repo → fix the PAT scope, do not rotate blindly.
5. Supabase: dashboard shows the integration healthy; the next push to `main` still shows a `Supabase Preview` check and `x-deploy-sha` moves.
6. Smoke URLs (expect 200, no console errors): `/`, `/index.pt.html`, `/index.es.html`, `/index.jp.html`, `/insights.html`, `/financial-crimes/`, `/small-business/`,
   `/bolao/` (redirects to `/bolao/br2026/`), `/bolao/br2026/`, `/bolao/cdb2026/`, `/bolao/copa2026/`, `/bolao/copa2026/audit-report.html`,
   `/bolao/loterias/powerball/`, `/bolao/loterias/powerball/tickets/2026-08-12-v1/tickets.pdf`, `/sitemap.xml`, `/CNAME` host. Expect **404**: `/docs/`, `/scripts/verify.mjs`, `/CLAUDE.md`, `/supabase/config.toml`.
7. Open an app, submit nothing; verify live data loads (Network tab: `espn-normalized.json`, Supabase REST 200).
8. Within 24 h: confirm a scheduled data commit (`bolao_provider_snapshot`) still lands and redeploys; confirm no workflow reports quota exhaustion.

## 4. Rollback decision tree

- **Site down / Pages unpublished** (plan can't host private Pages) → *Make public again* (section 5 A) immediately; the site returns on the next deploy (`gh workflow run "Deploy GitHub Pages"`). Then fix the plan, retry later.
- **Site up, Actions blocked by quota** → do NOT go public for this alone: add payment method/raise spending limit, or disable the 5-min Worker cron, or move heavy jobs. Public is the fallback only if production data freshness is at risk and no budget decision can be made quickly.
- **Worker dispatch 404** → fix PAT repo access (no visibility change needed).
- **Supabase deploy stopped** → reconnect the integration in the Supabase dashboard; as stopgap deploy the function manually (existing `x-deploy-sha` drift gate reports `LIVE_DRIFT`).
- **Anything else unclear** within the first hour → make public again, investigate calmly.

## 5. Rollback procedure

A. Make public again: Settings → Danger Zone → Make public (or `gh repo edit ... --visibility public --accept-visibility-change-consequences`). Re-run Pages deploy.
B. Pipeline-only rollback (keep private): `git revert <merge commit of the allowlist PR>` restores the old rsync deploy — **do not do this while private is the goal**, it would re-publish docs/scripts/SQL.
   Prefer fixing the manifest forward (add the missing path to `scripts/public-site.manifest.json`, which is a one-line change).
C. A site breakage caused by a missing file after merge: the artifact gate catches dangling html/css refs before deploy; JS-loaded paths are covered by the smoke test. Add the file to the manifest and redeploy.

## 6. What making it public again would and would not fix

Fixes: Pages hosting on a Free plan, free Actions minutes, anonymous GitHub reads. Does **not** fix: anything already copied (forks, clones, caches, search/Archive snapshots made while public), links broken by the audit-page change (those were intentionally removed), or a Pages deploy that was blocked by a failing gate (fix the gate input instead).

## 7. Adding files to the public site after migration

New file reachable by browsers or emails ⇒ add its exact path to `scripts/public-site.manifest.json` in the same PR. `npm run check:public-artifact` fails otherwise (dangling reference) and the smoke test fails for JS-loaded files. Never add directories, `docs/`, `scripts/`, SQL, Python, JSONL or `*.md`.

## 8. Known historical exposure that privatization cannot undo

The repo was public from creation: all commit history (including internal docs, SQL, scripts, incident write-ups, the real Powerball ticket serials, the admin SHA-256 hashes, public anon/EmailJS keys) may already be cloned, forked or indexed. Rewriting history is a separate destructive decision (ADR-011) and is out of scope. Rotate nothing as part of this migration unless a separate review finds a live secret (none found in the artifact scan; the history was not secret-scanned here — recommended: run a full-history scan such as gitleaks before the flip).
