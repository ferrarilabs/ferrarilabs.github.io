# Worker / GitHub token audit (public -> private)

Scope: every programmatic consumer of `ferrarilabs/ferrarilabs.github.io`. Method: static read of the
repo at branch `chore/private-repo-readiness`. No secret values read, nothing run, no external console
opened. Rule applied: a private repo returns **404** (not 401/403) to anonymous callers and to any
credential that lacks access to it; a fine-grained PAT or App installation that already includes the
repo, with the needed permission, keeps working unchanged.

## 1. Actor / integration table

| # | Actor | Credential | Permission needed | Evidence | Expected after PRIVATE | Verification (Eduardo, read-only) |
|---|-------|-----------|-------------------|----------|------------------------|-----------------------------------|
| 1 | Worker `ferrarilabs-live-producer`: POST workflow dispatch for `live_cache_producer.yml` | Fine-grained PAT, secret `GH_DISPATCH_TOKEN` (Worker secret; value not inspected) | Repository access incl. this repo; **Actions: write** (+ Metadata: read, implicit) | `workers/live-producer/src/index.ts:53-84` (Bearer header :69, URL :62-63); `wrangler.jsonc:56,59-60`; scope claim `index.ts:25`, `wrangler.jsonc:25` | **Keeps working** if the PAT's "repository access" lists this repo (selected repos or all) and Actions:write is granted: PAT access is by repo grant, not visibility. Fails with **404** (logged as `RECUSADO dispatch http 404`) if the PAT was created as "Public repositories (read-only)" or is expired/revoked. Note: a PAT with Actions:write can only dispatch a workflow that exists on the ref; workflow files stay in the repo. | In GitHub > Settings > Developer settings > Fine-grained tokens: open the token used for `GH_DISPATCH_TOKEN`; confirm Resource owner = ferrarilabs, repository access includes `ferrarilabs.github.io`, Actions = Read and write, expiry date is in the future, and who owns it (a person who leaves/loses org access breaks it). Then, after the flip, without exposing the token: `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" https://api.github.com/repos/ferrarilabs/ferrarilabs.github.io/actions/workflows/live_cache_producer.yml` expect 200 (GET proves visibility; the real dispatch POST returns 204 and runs the producer, so prefer to let the Worker's next cron tick do it and check Actions > "live_cache_producer" for a `workflow_dispatch` run + Worker logs in the Cloudflare dashboard showing no `http 404/403`). Also `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/ferrarilabs/ferrarilabs.github.io/actions/workflows/live_cache_producer.yml` with NO token should be 404 (confirms private). |
| 2 | Worker `user-report-intake`: create Issues, search, comment | **GitHub App** installation token (JWT from `REPORT_GITHUB_PRIVATE_KEY`, App ID, Installation ID) | Issues: write + Metadata: read, installed only on `ferrarilabs/support-intake` | `workers/user-report-intake/src/github.ts:28,142-153,164-169,182-185,201-218`; `wrangler.jsonc:69-71,83-84` (`REPORT_GITHUB_REPO=support-intake`); `provisionar.mjs:96-126`; docs `SECURE_USER_REPORTING.md:90` | **Not affected.** Targets a different, already-private repo (`support-intake`); `verificarDestinoPrivado` (github.ts:164) even requires that target to be private. The App is deliberately NOT installed on `ferrarilabs.github.io`; flipping visibility does not touch it. | Confirm App installation list excludes `ferrarilabs.github.io` (GitHub > Org settings > Installed GitHub Apps > Configure). Nothing else needed. |
| 3 | Sentinel (`scripts/sentinel/*`, workflow `sentinel.yml`) GitHub reads/writes (issues, labels, search; GraphQL Projects v2) | `gh` CLI in CI with `GH_TOKEN = secrets.SENTINEL_PROJECT_TOKEN \|\| secrets.GITHUB_TOKEN` (authenticated; PAT/App token for projects, else GITHUB_TOKEN) | issues: write, contents: read (GITHUB_TOKEN); `project` scope for Projects v2 (PAT) | `scripts/sentinel/github_client.mjs:23,31-60` (`execFileSync("gh")`, `REPO` const); `.github/workflows/sentinel.yml:35-37,49`; `docs/bolao/sentinel/README.md:36,153-154` | **Keeps working.** GITHUB_TOKEN is minted per run with the repo's own permissions. If `SENTINEL_PROJECT_TOKEN` exists it is a user-level PAT/App token: must include this repo. Project (user-owned Projects v2 "Ferrarilabs Engineering") is unaffected by repo visibility. Anonymous: none. | Repo Settings > Secrets: is `SENTINEL_PROJECT_TOKEN` present? If yes, check its repo access as in row 1 (Issues r/w + Projects). Last Sentinel run green after flip. |
| 4 | Sentinel detectors: Supabase / live function reads | Supabase Management token (`SENTINEL_SUPABASE_MGMT_TOKEN`), anon fetch of public Supabase function URL | Supabase `database_migrations_read` | `scripts/sentinel/run.mjs:121` (fetch of `cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football`), `supabase_migrations_api.mjs:31,77-92` | Not GitHub. Unaffected by repo visibility. | n/a |
| 5 | `live_pipeline_monitor.yml` Issue lifecycle (`gh issue create/list/edit/comment/close`) | `GITHUB_TOKEN` | issues: write | `.github/workflows/live_pipeline_monitor.yml:44-46,79,94-131` | Keeps working. | Next scheduled run green. |
| 6 | `cdb2026_result_email_watch.yml` incident state via Issues | `SENTINEL_PROJECT_TOKEN \|\| GITHUB_TOKEN` | issues: write | `.github/workflows/cdb2026_result_email_watch.yml:65-67,105` | Keeps working (same condition as row 3). | Same as row 3. |
| 7 | Workflows dispatching the Pages deploy: `sync_version.yml`, `bolao_provider_snapshot.yml`, `br2026_broadcast_epg.yml`, `lottery_poll.yml` (`gh workflow run "Deploy GitHub Pages"`) | `GITHUB_TOKEN` | actions: write, contents: write | `sync_version.yml:56-61,169-171`; `bolao_provider_snapshot.yml:86-94,236-238`; `br2026_broadcast_epg.yml:36-38,119-121`; `lottery_poll.yml:46-52,121-122` | Keeps working (token is repo-scoped, visibility-independent). Caveat in section 3 (Pages hosting). | Trigger/await one bot commit, confirm "Deploy GitHub Pages" run appears. |
| 8 | `deploy-pages.yml` (configure-pages, upload-pages-artifact, deploy-pages) | OIDC `id-token: write`, `pages: write` | pages: write | `.github/workflows/deploy-pages.yml:9-12,32-69` | **Plan-dependent, UNVERIFIED.** GitHub Pages for a private repo requires a paid plan (Pro/Team/Enterprise Cloud). If the org is not eligible, `configure-pages` fails and production hosting (`www.ferrarilabs.com`) stops. See section 3. | Org Settings > Billing: plan. Repo Settings > Pages: confirm Pages remains enabled/available after switching visibility (do it in a maintenance window or check the plan first). |
| 9 | Many workflows: `actions/checkout`, `download-artifact` with `GITHUB_TOKEN`, `contents: write` bot commits (auto_results, powerball, snapshot, etc.) | `GITHUB_TOKEN` | contents r/w, actions: read | e.g. `auto_results.yml:38-49`, `cdb2026_receipt_catchup.yml:35-37,82`, `powerball-results-email.yml:60-72` | Keeps working. All checkouts are of this same repo; no `repository:` cross-repo input found (`grep repository:` empty). | None. |
| 10 | `scripts/report/readiness.mjs:395` `gh api repos/ferrarilabs/support-intake` | local `gh` auth (operator) | read on support-intake | `readiness.mjs:395` | Unaffected (other repo). | n/a |
| 11 | Supabase GitHub integration (check "Supabase Preview"; auto-migrate + deploy of `supabase/functions/live-football` on push to main) | Supabase GitHub App installed on the repo (managed in Supabase dashboard, not in repo) | Contents: read, plus checks/PR/commit-status write | `CLAUDE.md` "Autonomia em supabase/functions" (~:459-470); `supabase/config.toml:1-9`; `docs/bolao/SECURE_USER_REPORTING.md:22,539-550`; `docs/bolao/adr/ADR-021:171-178` | **Likely keeps working, UNVERIFIED.** The Supabase GitHub App uses an installation grant, so private repos are supported; it must remain installed with access to this repo. Visibility change does not revoke an installation, but if the install is "selected repositories" the repo stays included. Risk is a silent non-deploy (known failure mode), so verify actively. | Supabase dashboard > Project `cmhqkkfczotdnssupkni` > Integrations > GitHub: repo still connected, no "reconnect" banner. After the flip, merge a trivial `supabase/functions` change (or re-run) and compare `x-deploy-sha`: `curl -sI 'https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football?competition=br2026' \| grep -i x-deploy-sha` vs the SHA in `supabase/functions/_shared/deploy_manifest.js` (the repo's own `live-function-drift` gate does this with `VERIFY_ALLOW_NETWORK=1`). |
| 12 | Cloudflare Workers deploy | Wrangler from operator machine; no Cloudflare-Git integration evidence in repo | n/a | `workers/*/wrangler.jsonc` (no git/build config) | **UNVERIFIED.** If either Worker was connected via Cloudflare Workers Builds / Git integration, that connection uses a Cloudflare GitHub App grant and must be re-checked. Repo shows no sign of it. | Cloudflare dashboard > Workers > each worker > Settings > Builds: "Git repository" connected? If yes, confirm the Cloudflare GitHub App still has access. |
| 13 | Claude Code / GitHub MCP / `gh` in agent sessions and `.claude/commands/*` | Operator's own auth / session grants | per task | `.claude/commands/issue-*.md`, `historical-*.md` | Keeps working for authorized sessions; any session/connector whose GitHub App grant excludes the repo gets 404. | Check Claude GitHub App installation includes the repo. |
| 14 | Dependabot / branch protection / Pages custom domain | n/a in repo | n/a | none found in `.github/` beyond workflows and ISSUE_TEMPLATE | Not evidenced. | Org console review. |

Cloudflare MCP was not used: Worker secret presence/scope cannot be read through it without touching
secret-adjacent data, so the credential's actual scope remains an external-console check.

## 2. Anonymous GitHub dependency audit

Searched for `api.github.com`, `raw.githubusercontent`, `githubusercontent`, `git clone`, `curl`/`fetch`
against github.com across `scripts/`, `bolao/`, `workers/`, `supabase/`, `.github/`, `docs/` (excluding
node_modules).

- **Anonymous API reads: none found.** Every `api.github.com` call in Worker code carries a Bearer
  token (`live-producer/src/index.ts:69`; `github.ts:144,166,185,204,218`; `provisionar.mjs:89,119`).
  Sentinel and workflow code use the authenticated `gh` CLI.
- **Raw URLs: none.** No `raw.githubusercontent.com` reference anywhere.
- **Unauthenticated `git clone` over HTTPS in automation: none** in scripts/CI. The only `git clone`
  references are in `bolao/shared/scripts/test_durable_persist.py:7` (a local bare repo in a temp
  dir) and a comment in `scripts/report/test_report_security_ratchets.mjs:35`.
- **Runtime fetches of this repo's contents by deployed apps:** the apps fetch their data from the
  Pages-hosted site (`www.ferrarilabs.com`) and Supabase, not from GitHub raw/API. Not exhaustively
  re-proven for every `fetch(` in `bolao/**/js` (see Unverified).
- **Public human-facing links to repo blobs (these will 404 for the public after the flip):**
  - `bolao/copa2026/audit-report.html:78,156,234` (three languages) link "source code" to
    `https://github.com/ferrarilabs/ferrarilabs.github.io/blob/main/bolao/copa2026/scripts/generate_audit_report.py`
  - `bolao/copa2026/scripts/generate_audit_report.py:47` (`GITHUB_REPO_URL`, generator of that page; a regeneration would re-emit the broken link)
  - `bolao/cdb2026/scripts/register_final_topology.py:107` (`sourceUrl` to `docs/bolao/CDB2026_RULES_AND_MODEL.md`, stored as a data field, may surface to participants)
  - The audit report was emailed to participants (per CLAUDE.md) so recipients holding the link will see 404.
  - Not checked: contents of already-sent emails (Gmail/EmailJS templates) and Supabase-stored `sourceUrl` rows; those live outside the repo.
  - `.github/ISSUE_TEMPLATE/config.yml` and `docs/` mention repo URLs for contributors only (not exposed to the public).

## 3. Other findings

1. **Pages on private repo is plan-gated** (row 8). This is the single biggest risk: it is not a
   token issue but would take production down. Must be confirmed before flipping.
2. Live-producer error handling logs `dispatch http <status>` and returns `RECUSADO`; a revoked or
   mis-scoped PAT would present as a 404 there (and in the "live pipeline monitor" only if that probe
   covers freshness). Failure is visible but not alarmed by itself.
3. Concurrency/identity: fine-grained PATs owned by a person disappear if that person's org access
   changes; consider an App (as already done for the intake worker). Out of scope for this task.
4. `SENTINEL_PROJECT_TOKEN` existence is unknown from the repo (documented as optional).

## 4. Verdicts

**Worker/GitHub token audit: PASS (conditional).** Repo evidence shows no credential that depends on
public visibility: the Worker dispatch uses a PAT scoped by design to Actions:write on this repo (row 1),
the intake Worker uses an App on a different private repo (row 2), and all workflows use repo-scoped
GITHUB_TOKEN (rows 5-9). The condition is that the live-producer PAT's repository access and Actions:write
are as documented, which only the GitHub console can prove.

**Anonymous GitHub dependency audit: PASS for automation, with findings for human links.** No anonymous
API/raw/clone dependency in code, CI or Workers. Three public-facing links to `github.com/.../blob/main`
(section 2) will 404 and should be removed or repointed before or with the flip.

## 5. UNVERIFIED (needs external consoles)

- Actual scope, expiry, owner and repo grant of the `GH_DISPATCH_TOKEN` PAT (GitHub fine-grained token page).
- Whether `GH_DISPATCH_TOKEN` is actually set on the deployed Worker (Cloudflare dashboard).
- Presence/scope of `SENTINEL_PROJECT_TOKEN` (repo secrets).
- Supabase GitHub integration still connected and deploying after the flip (Supabase dashboard + `x-deploy-sha` check).
- Cloudflare Workers Builds / Git integration, if any.
- GitHub org plan eligibility for Pages from a private repo, and Pages custom-domain behavior after flip.
- Claude/other GitHub App installations covering the repo.
- Content of emails already sent and any Supabase rows holding `sourceUrl`.
- Exhaustive scan of browser JS in `bolao/**/js` for GitHub URLs was grep-based only (no hits).
