# GitHub Actions inventory for a public -> private migration

Scope: all 34 files in `.github/workflows/`, each read in full on branch `chore/private-repo-readiness`.
Read-only research. No workflow was run, no secret value or participant PII was read or printed.
Evidence date: 2026-10-01. Run data came from `gh api repos/ferrarilabs/ferrarilabs.github.io/actions/workflows/<file>/runs`
for runs created since 2026-08-31.

## 0. Verdict

**PLAN VERIFICATION REQUIRED BEFORE PRIVATIZATION.**

- The repo owner is a personal account: `owner.type = "User"`, `login = ferrarilabs`, and the repo is currently `public`
  (`gh api repos/ferrarilabs/ferrarilabs.github.io`). It is not an organization, so the "org plan" wording in
  `WORKER_TOKEN_AUDIT.md` should read "account plan".
- The account PLAN could not be read. `gh api user`, `/users/ferrarilabs`, `/orgs/...` and `/pages` are blocked by the session
  proxy (HTTP 403). The billing endpoints are not reachable either.
- The plan decides two things, and either one can be a blocker:
  1. whether GitHub Pages keeps serving `www.ferrarilabs.com` (Free: public repos only; Pro or higher: private repos);
  2. which Actions quota applies (2,000 min on Free, 3,000 on Pro or Team).
- Measured usage is roughly 12,000 min/month, 4 to 6 times any non-Enterprise quota. Privatizing without a workflow diet will
  exhaust the quota. See sections 3 and 4.

## 1. Official-docs verification (cited)

| Claim | Verified? | Source |
|---|---|---|
| Included Actions minutes per month: Free 2,000; Pro 3,000; Team 3,000; Enterprise Cloud 50,000 | Yes | https://docs.github.com/en/billing/concepts/product-billing/github-actions and https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions |
| Standard GitHub-hosted runners are free for public repos (and free for self-hosted runners) | Yes, quoted: "free for self-hosted runners and for public repositories that use standard GitHub-hosted runners" | same pages |
| Linux 2-core is the base rate ($0.006/min) | Yes (rate table) | same pages |
| ubuntu multiplier is 1x | Not in the fetched text. Inferred: Linux 2-core is the base rate, and every workflow here is `ubuntu-latest`. | same pages |
| Per-job round-up to the whole minute | Not stated in the fetched pages. I assumed it from general GitHub knowledge, so treat it as unverified. Every run here is under 1 min, so the assumption matters a lot. | - |
| Quota exhausted: usage is blocked if there is no valid payment method on file; otherwise overage is billed | Yes ("If your account does not have a valid payment method on file, usage is blocked once you use up your quota") | billing page above |
| Plans: Free = Pages in public repos; Pro adds Pages in private repos | Yes | https://docs.github.com/en/get-started/learning-about-github/githubs-plans |
| Actions-based Pages publishing (`configure-pages`, `upload-pages-artifact`, `deploy-pages`) is the documented custom-workflow path | Yes | https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site |

## 2. Pages private-repo compatibility

- **Plan gate.** The plans page says GitHub Free for personal accounts includes "GitHub Pages in public repositories".
  GitHub Pro lists Pages among the private-repo features. Team and Enterprise Cloud also support it (general GitHub knowledge, not
  re-fetched this session). Per that table, a Free personal account cannot publish Pages from a private repo.
- **The site stays public.** The publishing-source page warns: "GitHub Pages sites are publicly available on the internet, even
  if the repository for the site is private (if your plan or organization allows it)." Private-by-access-control is an
  Enterprise Cloud feature that I could not verify here, and it is not wanted anyway, since this is a public marketing and bolao site.
- **Actions-based deploy.** `deploy-pages.yml` already uses the documented flow (`pages: write`, `id-token: write`, environment
  `github-pages`). Nothing in it depends on visibility. The same quota applies, because for a private repo it costs billable
  minutes (about 160 runs/month, about 1 min each).
- **Custom domain.** `CNAME` = `www.ferrarilabs.com`. The `.github.io` and apex hosts 301 to it. No doc evidence was found that
  privacy removes a custom domain on an eligible plan. I could not verify this; test before relying on it.
- **Unknown.** I did not fetch the page on changing a Pages site's visibility, and I could not read `GET /repos/.../pages`
  (proxy-blocked). I therefore cannot say what happens to the published site at the moment visibility flips on an ineligible plan.
  Assume the worst case, in which the site is unpublished and production goes down.
- **Required before the flip.** Eduardo checks Settings > Billing and plans (account plan), then Repo Settings > Pages. If the plan
  is Free, either upgrade to Pro or move hosting off Pages, for example Cloudflare Pages or a Worker serving static assets.
  The `workers/` directory shows the Cloudflare account already exists.
- **Verdict:** PLAN VERIFICATION REQUIRED BEFORE PRIVATIZATION.

## 3. Evidence on run volume and duration

Method: for each workflow I counted runs created since 2026-08-31 and computed `updated_at - run_started_at` as wall time.
Wall time is not billed time. It is a proxy that includes queue and teardown, and billing rounds each job up to a minute (unverified, see
section 1). I therefore estimate billed minutes as `ceil(duration)` per job, with a minimum of 1 minute. That matches the
documented round-up for runs under 60 s. A few things are not captured by this proxy: the cdb2026_result_emails run that
lasted about 50 min, the matrix doubling in `bolao_provider_snapshot`, and cancelled runs.

Notable measured facts:

- `live_cache_producer.yml`: 987 `workflow_dispatch` runs in the last ~7 days (99 on 09-25, then 233, 288, 288, 79 per
  day from 09-28). This is the Cloudflare Worker `ferrarilabs-live-producer` (`*/5 * * * *`, 24 h, 288/day) dispatching
  the workflow through the REST API. The listing was capped at 1,000 runs, so this is a floor. At 288/day the monthly cost is
  **about 8,640 runs = about 8,640 min**, the largest single item. It billed about 16 s of wall time per run, which rounds
  up to 1 min. The workflow's own schedule (`*/5 14-23,0-2`) only appears 13 times in the sample, because GitHub throttles
  `schedule` events. The Worker, not GitHub's cron, is what actually drives the cadence.
- `safety_check.yml`: 126 runs (79 PR, 46 push, 1 dispatch), average wall 692 s (about 11.5 min), max 2,174 s. About **1,500
  billed min/month**, and it varies with PR activity. 28 runs were cancelled (concurrency `cancel-in-progress` on PRs).
- `bolao_provider_snapshot.yml`: 187 scheduled runs in 31 days (nominal `*/10` would be 4,464, so GitHub throttles it heavily).
  Each run has a 2-job matrix (br2026, cdb2026), so about 2 billed min per run, about 380 min.
- `cdb2026_entry_saved_confirmation.yml`: 192 runs observed, against a nominal 8,640/month for `*/5`. It is throttled.
- `cdb2026_result_emails.yml`: 164 runs, one of them about 2,971 s (about 50 min; `timeout-minutes: 100`).
- `br2026_round_emails.yml`: 21 of 98 runs ended `failure` (rate not explained here, see notes).
- `deploy-pages.yml`: 158 runs (46 push, 112 workflow_dispatch). The dispatches come from other workflows: snapshot, EPG,
  lottery and sync_version call `gh workflow run "Deploy GitHub Pages"`. They exist because a push made with `GITHUB_TOKEN`
  does not trigger anything.
- `auto_results.yml` (Copa) had zero runs, which is consistent with its cron being limited to months 6-7.

Key point for privatization: the observed schedule counts are what GitHub actually delivered **today**. GitHub's own docs
warn that high-frequency schedules are delayed and dropped. Nominal cron values are an upper bound, not a forecast.

## 4. Monthly-minutes estimate vs private quotas

Per-workflow numbers are in the table in section 5. Totals use a 30-day month.

| Scenario | Assumption | Minutes/month |
|---|---|---|
| **Observed (best estimate)** | Last-31-day billed estimate for everything except `live_cache_producer`: about 3,300 plus about 190 matrix extra = **about 3,500**. `live_cache_producer` at 288/day x 30 = **8,640** (plus about 20 schedule runs). | **about 12,000** |
| **Low** | As observed, but treating cancelled and short PR runs as free and `safety_check` at only about 900 min | **about 11,000** |
| **High (nominal cron, no throttling)** | provider_snapshot 4,320 runs x 2 jobs = 8,640; entry_saved 8,640; result_emails 2,520; round_emails 480; epg 240; schedule_watch 360; monitor 720; lottery 197; powerball results about 814; jackpot 120; sentinel 30; coverage 30; watch 60; live Worker 8,640 + live cron 4,680; plus CI about 1,500, deploy about 160, sync about 20 | **about 38,000** |

| Plan | Included min | Observed (about 12k) | High (about 38k) |
|---|---|---|---|
| Free | 2,000 | exceeds by about 6x | exceeds by about 19x |
| Pro | 3,000 | exceeds by about 4x | exceeds by about 13x |
| Team | 3,000 | exceeds by about 4x | exceeds by about 13x |
| Enterprise Cloud | 50,000 | fits | fits (76%) |

Assumptions: every job is `ubuntu-latest` at 1x; each run bills at least 1 min; matrix jobs bill separately; runs
that fail or are cancelled still bill; `auto_results.yml` is inactive outside June and July (nominally 0 in October, but in
June or July it would add up to about 2,520 runs per month (84 runs/day), if it fired); GitHub does not apply a minimum
beyond the whole minute.

Consequences:

- Without changes, the private repo hits its quota in the first week (Free: about 5 days; Pro: about 7 days).
  When the quota ends and no payment method is on file, runs are **blocked**. If a payment method is on file, overage is
  billed instead, at $0.006/min, so about 9,000 to 10,000 extra min = about $55 to $60/month on Pro. Check this
  number against the real pricing page before relying on it.
- Production behaviours at risk when blocked: email on results (CDB, BR, Powerball), the deploy workflow (the site stops updating),
  the live cache producer, and the Safety check on PRs.
- The two big levers are the 5-minute Worker dispatch (about 8,640 min) and `safety_check` (about 1,500 min). Moving or
  trimming just those two takes the observed total to about 2,000. That is still at the edge of the Free quota.

## 5. Inventory table

Legend. Crit = production-critical (P), deploy-critical (D), tests only (T), diagnostics or one-off (X), historical or obsolete (H?).
Repo writes: commit or push to the repo. DB = writes Supabase with the service-role key. Mail = sends email. Ext = calls an
external provider. Nominal = executions/month implied by the cron. Observed = runs in the last 31 days. Wall = measured average
wall time (not billed). "Dispatch" = workflow_dispatch available.

| # | File | Triggers | Cron | Nominal /month | Observed (31 d) | Dispatch | Runtime | Crit | Local / manual / migrate? | Repo writes | DB | Mail | Ext | Risk if disabled | After private | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | auto_results.yml | schedule, dispatch | `*/10 16-23` and `*/10 0-5`, months 6-7 | 0 in Oct; about 2,520 in Jun-Jul | 0 | yes | timeout 100 min; est 1-3 min | H? (Copa concluded 2026-07-19) | Manual only; schedule not needed | yes (`config.js` reopen commit) | yes | yes (Copa result emails) | ESPN | None now. In Jun-Jul 2027 would resume sending Copa emails. | Dispatch OK. A push by `GITHUB_TOKEN` still works. | KEEP_MANUAL_ONLY |
| 2 | bolao_provider_snapshot.yml | schedule, dispatch | `*/10 * * * *` | 4,320 x 2 matrix jobs | 187 sched + 3 dispatch | yes | timeout 10; measured avg 38 s, max 124 s; Playwright validate when snapshot changes | P (live data for BR/CDB) | MIGRATE_LATER (writes JSON to repo; could go to Supabase or R2) | yes (commit `bolao/*/data/` + dispatches Pages deploy) | no | no | ESPN | Snapshots go stale; apps fall back to last-known | Works (GITHUB_TOKEN push). Consumes about 380 min observed, 8,640 nominal. Each commit triggers a Pages deploy. | MIGRATE_LATER |
| 3 | br2026_broadcast_coverage.yml | schedule, dispatch | `0 12 * * *` | 30 | 24 | yes | timeout 5; avg 18 s | X (report only, no writes) | Could be manual-only or local | no | no | no | no | Lose a daily coverage report | Works; about 30 min/month | INVESTIGATE |
| 4 | br2026_broadcast_epg.yml | schedule, dispatch | `17 */3 * * *` | 240 | 77 | yes | timeout 15; avg 18 s | P (BR "Onde assistir" data) | MIGRATE_LATER candidate | yes (`broadcasts.json` commit + Pages deploy) | no | no | TV EPG source | Broadcast info goes stale | Works | KEEP_AUTOMATIC |
| 5 | br2026_round_emails.yml | schedule, dispatch | `*/30 21-23` and `*/30 0-4` | 480 | 98 (21 failed) | yes | timeout 20; avg 16 s | P (real emails to participants) | Could move to Supabase pg_cron/edge later; not now | no | yes | yes | EmailJS | Round emails not sent | Works if secrets remain. The failure rate (21/98) is unexplained here and should be investigated first. | KEEP_AUTOMATIC |
| 6 | cdb2026_confirmation_fake_transport_test.yml | dispatch | none | 0 | 0 | yes | est 1 min | T | Manual / local | no | read | no (fake transport) | no | None | Works | KEEP_MANUAL_ONLY |
| 7 | cdb2026_confirmation_forensics.yml | dispatch | none | 0 | 0 | yes | est 1 min | X, H? | Manual | no | read | no | no | None | Works | KEEP_MANUAL_ONLY |
| 8 | cdb2026_confirmation_readiness.yml | dispatch | none | 0 | 0 | yes | est 1 min | X | Manual | no | read | no | no | None | Works | KEEP_MANUAL_ONLY |
| 9 | cdb2026_entry_saved_confirmation.yml | schedule, dispatch | `*/5 * * * *` | 8,640 | 192 | yes | no timeout; avg 15 s, max 49 s | P (receipt email on entry save) | **MIGRATE_LATER**: a queue-consumer is a natural fit for Supabase pg_cron or an edge function | no | yes | yes | EmailJS | Participants stop getting receipts | Works, but is the biggest nominal scheduler. GitHub throttles it (192 vs 8,640). | MIGRATE_LATER |
| 10 | cdb2026_grant_receipt_allowance.yml | dispatch | none | 0 | 0 | yes | est 1 min | X | Manual | no | yes (conceder) | no | no | None | Works | KEEP_MANUAL_ONLY |
| 11 | cdb2026_ledger_reconciliation.yml | dispatch | none | 0 | 3 | yes | timeout 15; avg 17 s | X (ops) | Manual | no | yes (apply) | no | no | Cannot repair ledger | Works | KEEP_MANUAL_ONLY |
| 12 | cdb2026_operator.yml | dispatch | none | 0 | 16 | yes | timeout 10; avg 17 s | P (ops tool) | Manual | no | yes (apply) | no | no | Operators lose the server-side tool | Works | KEEP_MANUAL_ONLY |
| 13 | cdb2026_qf_reminder.yml | dispatch | none | 0 | 0 | yes | timeout 10-15 | H? (quarterfinals reminder) | Manual | no | yes | yes (enviar) | EmailJS | None | Works | KEEP_MANUAL_ONLY |
| 14 | cdb2026_receipt_catchup.yml | dispatch | none | 0 | 0 | yes | est 1-2 min | X | Manual. Uses artifact download across runs, which needs the same repo token (OK private). | no | yes | yes (enviar) | EmailJS | Cannot catch up lost receipts | Artifacts are fine (30-day retention). Artifacts and caches count against storage on private repos. | KEEP_MANUAL_ONLY |
| 15 | cdb2026_receipt_template_test.yml | dispatch | none | 0 | 0 | yes | est 1 min | T | Manual | no | read | yes (1 email to operator) | EmailJS | None | Works | KEEP_MANUAL_ONLY |
| 16 | cdb2026_register_topology.yml | dispatch | none | 0 | 0 | yes | timeout 6 | H? (semifinal topology one-off) | Manual | no | yes (apply) | no | no | None | Works | KEEP_MANUAL_ONLY |
| 17 | cdb2026_restore_picks.yml | dispatch | none | 0 | 0 | yes | timeout 6 | X (break-glass) | Manual | no | yes (apply) | no | no | Cannot restore one entry's picks | Works | KEEP_MANUAL_ONLY |
| 18 | cdb2026_result_email_recovery.yml | dispatch | none | 0 | 8 (7 failed) | yes | timeout 30; avg 22 s | X (recovery) | Manual | no | yes | yes (send) | EmailJS | Cannot recover missed result emails | Works | KEEP_MANUAL_ONLY |
| 19 | cdb2026_result_email_watch.yml | schedule, dispatch | `17 8 * * *`, `17 20 * * *` | 60 | 60 | yes | timeout 5; avg 18 s | P (monitoring) | Could migrate | no (opens/updates Issues) | read | no | no | Missed result emails go unnoticed | Works. Uses `SENTINEL_PROJECT_TOKEN` or `GITHUB_TOKEN`; Issues need a private-repo token (OK). | KEEP_AUTOMATIC |
| 20 | cdb2026_result_emails.yml | schedule, dispatch | `*/10 16-23` and `*/10 0-5` | 2,520 | 164 (one run about 50 min) | yes | timeout 100; avg 34 s, max 2,971 s | P (real emails; money-adjacent) | MIGRATE_LATER possible, but not in this task | no | yes | yes | ESPN, EmailJS | Participants do not get result emails | Works. About 214 billed min observed. | KEEP_AUTOMATIC |
| 21 | cdb2026_schedule_watch.yml | schedule, dispatch | `40 */2 * * *` | 360 | 149 | yes | timeout 8; avg 16 s | P? (scheduled phase is hard-coded to `quartas`; it applies and may send invitations) | Quartas is over. Check whether the scheduled path should move to `semifinal` or stop. | no | yes (apply) | yes (invitation) | official schedule source, EmailJS | If the phase is done, nothing; otherwise missed invitations | Works | INVESTIGATE |
| 22 | copa2026_operator.yml | dispatch | none | 0 | 0 | yes | timeout 10 | H? (Copa archived) | Manual | no | yes (apply) | no | no | None | Works | KEEP_MANUAL_ONLY |
| 23 | deploy-pages.yml | push main, dispatch | none | about 160/month | 158 (46 push, 112 dispatch) | yes | timeout 20; avg 29 s | **D** (production hosting) | Not migratable without hosting change | no | no | no | GitHub Pages | Site stops updating | **Plan-dependent** (section 2) | KEEP_AUTOMATIC |
| 24 | live_cache_producer.yml | schedule, dispatch (Worker-driven) | `*/5 14-23` and `*/5 0-2` (13 h/day) | 4,680 (schedule) + 8,640 (Worker) | 13 sched + 987 dispatch in about 7 days (capped) | yes | timeout 7; avg 16 s, max 146 s | P (live scores) | **Largest cost driver.** Needs a GH runner because ESPN blocks Cloudflare and Supabase egress (`workers/live-producer/src/index.ts`). Could gate the Worker to the window. | no | yes (`live_sports_cache`) | no | ESPN | Live scores go stale (gateway serves last-known-good up to 10 min) | Works if the Worker PAT has repo access and Actions: write (see `WORKER_TOKEN_AUDIT.md` row 1). Costs about 8,700 min/month. | INVESTIGATE |
| 25 | live_pipeline_monitor.yml | schedule, dispatch | `17 * * * *` | 720 | 164 | yes | timeout 8; avg 21 s | P (monitoring) | MIGRATE_LATER candidate | no (Issues) | read | no | probes production | Pipeline degradation goes unnoticed | Works (GITHUB_TOKEN, `issues: write`) | KEEP_AUTOMATIC |
| 26 | lottery_poll.yml | schedule, dispatch | `15 3-7 * * 2,4,0`; `15 3-7 * * 3,6`; `40 9,15,21 * * *` | about 197 | 104 | yes | timeout 12; avg 24 s | P (lottery results/state) | MIGRATE_LATER candidate | yes (commit + Pages deploy) | no | no | lottery sources | Lottery state goes stale | Works | KEEP_AUTOMATIC |
| 27 | lottery_production_state.yml | dispatch | none | 0 | 0 | yes | timeout 10 | X | Manual | no | yes (repair) | no | no | Cannot inspect or repair | Works | KEEP_MANUAL_ONLY |
| 28 | m8m9_probe.yml | dispatch | none | 0 | 0 | yes | timeout 6 | X, H? (M8/M9 diagnostic) | Manual | no | read | no | no | None | Works | KEEP_MANUAL_ONLY |
| 29 | powerball-results-email.yml | schedule, dispatch | six `*/10` windows + `0 8,12,16,20 * * *` | about 814 | 126 | yes | timeout 10; avg 22 s | P (real emails) | MIGRATE_LATER candidate | no | yes | yes | lottery sources, EmailJS | Results emails not sent | Works. Uses private secrets `POWERBALL_PRIVATE_*`. | KEEP_AUTOMATIC |
| 30 | powerball_jackpot_refresh.yml | schedule, dispatch | `25 */6 * * *` | 120 | 112 | yes | timeout 6; avg 14 s | P (jackpot display) | MIGRATE_LATER candidate | yes (commit `data.js`; does not dispatch Pages) | no | no | lottery source | Jackpot display stale | Works | KEEP_AUTOMATIC |
| 31 | powerball_record_payment.yml | dispatch | none | 0 | 0 | yes | timeout 5 | P (payments operator) | Manual | no | yes (apply) | no | no | Cannot record payments | Works | KEEP_MANUAL_ONLY |
| 32 | safety_check.yml | pull_request, push main, dispatch | none | about 125 runs | 126 (82 ok, 16 fail, 28 cancelled) | yes | timeout 45; avg 692 s, max 2,174 s | D/T (the canonical `npm run check` gate) | Can run locally (`npm run check`); CLAUDE.md demands it before every change anyway | no | no | no | no (Playwright browsers) | PR gate gone | Works. **About 1,500 billed min/month (the second-largest item).** | KEEP_AUTOMATIC |
| 33 | sentinel.yml | schedule, dispatch | `17 13 * * *` | 30 | 37 | yes | timeout 10; avg 40 s | P (monitoring, opens Issues) | Could migrate | no (Issues) | Supabase mgmt token | no | GitHub API | Detectors stop opening Issues | Works with `GITHUB_TOKEN` or `SENTINEL_PROJECT_TOKEN` | KEEP_AUTOMATIC |
| 34 | sync_version.yml | push main (paths) | none | about 20 | 19 | no | est 30 s | D (cache-bust `?v=` + Pages redeploy) | Could run locally | yes (commit) + dispatches Pages | no | no | no | Cache-bust version not bumped | Works | KEEP_AUTOMATIC |

## 6. Classification counts

| Class | Count | Files |
|---|---|---|
| KEEP_AUTOMATIC | 12 | #4 br2026_broadcast_epg, #5 br2026_round_emails, #19 cdb2026_result_email_watch, #20 cdb2026_result_emails, #23 deploy-pages, #25 live_pipeline_monitor, #26 lottery_poll, #29 powerball-results-email, #30 powerball_jackpot_refresh, #32 safety_check, #33 sentinel, #34 sync_version |
| KEEP_MANUAL_ONLY | 17 | #1 auto_results, #6, #7, #8, #10, #11, #12, #13, #14, #15, #16, #17, #18, #22, #27, #28, #31 |
| MIGRATE_LATER | 2 | #2 bolao_provider_snapshot, #9 cdb2026_entry_saved_confirmation |
| INVESTIGATE | 3 | #3 br2026_broadcast_coverage, #21 cdb2026_schedule_watch, #24 live_cache_producer |
| RETIRE | 0 | evidence is not conclusive for any workflow |

## 7. Visibility-dependent behaviour

- **Secrets.** Repo secrets stay set across a visibility change. All workflows use `SUPABASE_SERVICE_ROLE_KEY`;
  Powerball uses `POWERBALL_PRIVATE_PARTICIPANT_DATA` and `POWERBALL_PRIVATE_CONTACTS_EXTRA`; sentinel uses
  `SENTINEL_PROJECT_TOKEN` and `SENTINEL_SUPABASE_MGMT_TOKEN`. Names only, no values were read. They are not visibility-dependent.
- **`GITHUB_TOKEN` pushes** (auto_results, provider_snapshot, broadcast_epg, lottery_poll, powerball_jackpot_refresh,
  sync_version) use `contents: write` in the repo itself. They work in private repos. Branch protection or required checks on `main`
  could block them, which is the same as today.
- **Chained dispatches.** Six workflows run `gh workflow run "Deploy GitHub Pages"` with `actions: write` because pushes
  by `GITHUB_TOKEN` do not trigger other workflows. This keeps working. The Pages docs confirm the limitation:
  "Commits pushed by a GitHub Actions workflow that uses the GITHUB_TOKEN do not trigger a GitHub Pages build."
- **Worker PAT.** The Cloudflare Worker's fine-grained PAT needs this repo in its repository grant and `Actions: write`. See
  `WORKER_TOKEN_AUDIT.md` row 1.
- **Public-only features.**
  - GitHub Pages (plan-dependent, section 2).
  - Free public-repo minutes (lost on privatization, section 4).
  - Unauthenticated GitHub API or raw reads: a grep for `api.github.com` and `raw.githubusercontent` over tracked non-doc files
    found **no hits in scripts that run from these workflows**. The only `ferrarilabs.github.io` matches are site URLs, not
    API reads. `scripts/sentinel/github_client.mjs` authenticates. This search was limited to the repo tree; external consumers
    (the Supabase edge function, the apps in browsers) were not tested.
  - Supabase's GitHub integration (not a workflow) is covered in `WORKER_TOKEN_AUDIT.md` row 11.
- **Artifacts and caches.** `safety_check` and `provider_snapshot` use `actions/cache` for Playwright; `receipt_catchup` and
  `safety_check` upload artifacts. Private repos have a storage quota on these as well. Not measured here.

## 8. Notes and unresolved items

- No evidence could be gathered for `cdb2026_schedule_watch`'s current phase beyond the hard-coded `FASE="quartas"` for scheduled
  runs. Whether it is obsolete depends on business state, so it stays INVESTIGATE.
- `br2026_round_emails` failed 21 of 98 runs in the last 31 days; the cause was not examined (job logs were not fetched).
- Wall time from the API is a proxy. Exact billed minutes need the Billing > Usage report, which is unavailable here.
- I did not run or dispatch anything. `GET` calls were limited to repo-scoped, read-only endpoints.
- Suggested order for the next step, subject to Eduardo's decisions: (1) confirm the plan; (2) decide the live-producer cadence
  (the Worker is the main cost); (3) decide where `safety_check` runs; (4) only then flip visibility.
