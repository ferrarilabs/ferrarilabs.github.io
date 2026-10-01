# Schedules audit and monthly Actions model (Phases 3 + model)

Sources: every `.github/workflows/*.yml` cron read in this tree; run counts/durations observed over 31 days from the earlier audit
(`docs/private-repo-migration/ACTIONS_PRIVATE_REPO_AUDIT.md` on branch `chore/private-repo-readiness`); the producer from the committed
calendar. Reproduce: `node scripts/actions_minutes_model.mjs --month 2026-10`. **This is a model; Settings → Billing → Usage is the truth.**
Billing assumption (unverified in official docs by the earlier audit): each job rounds up to a whole minute, ubuntu 1×.
The account allowance seen in GitHub's 2026-09-15 email is 2,000 min; Pro would be 3,000, shared with any other private repo.

## Classification of every scheduled / dispatched workflow

| Workflow | Trigger / frequency | Billed shape | Class | Why / what to do |
|---|---|---|---|---|
| **live_cache_producer** (via Worker) | dispatch `*/5` 24 h; runner loops ~5 min in window | 1 min out-of-window, **6 min** in-window | **MOVE_OUT_OF_GITHUB** (to a public relay repo) | needs only a GitHub-IP GET; this branch makes the rest portable |
| live_pipeline_monitor | hourly `:17` | 1 min × 720 nominal / 164 seen | MOVE_OUT (later) → short term KEEP, window-limit the cron (`17 14-23,0-2`) | opens Issues with `GITHUB_TOKEN`; moving it needs a PAT elsewhere |
| bolao_provider_snapshot | `*/10`, 2-job matrix, commits JSON | 2 min × 187 seen (nominal 4,320 × 2) | KEEP_IN_GITHUB (needs ESPN egress + repo write) | throttled by GitHub today; if GitHub ever honors `*/10` it costs ~8,600 → **watch**; long term: relay + ingest model for snapshots |
| cdb2026_entry_saved_confirmation | `*/5` | 1 min × 192 seen (nominal 8,640) | **MAKE_EVENT_DRIVEN** (DB webhook/trigger → edge fn) | polls a queue every 5 min; same throttling caveat as above |
| cdb2026_result_emails | `*/10` 16–05 UTC | ~1.3 min × 164 | KEEP_IN_GITHUB (ESPN + EmailJS + private data) | money-adjacent; do not touch in this workstream |
| br2026_round_emails | `*/30` 21–04 | 1 min × 98 (21 failed) | KEEP_IN_GITHUB | investigate failures separately |
| powerball-results-email | six `*/10` windows + 4×/day | 1 min × 126 | KEEP_IN_GITHUB | schedule is draw-day specific |
| lottery_poll / powerball_jackpot_refresh / br2026_broadcast_epg | few per day, commit data | 1 min × 104 / 112 / 77 | KEEP_IN_GITHUB | small; they commit to the repo |
| cdb2026_schedule_watch | `40 */2` (hard-coded phase `quartas`) | 1 min × 149 | **REMOVE_OBSOLETE or MAKE_MANUAL_ONLY** pending Eduardo (quarterfinals are over) | saves ~149 min; business decision |
| cdb2026_result_email_watch / sentinel / br2026_broadcast_coverage | 1–2×/day | 1 min × 60 / 37 / 24 | KEEP_IN_GITHUB (cheap) — coverage → MAKE_MANUAL_ONLY | |
| auto_results (Copa) | months 6–7 only | 0 now | MAKE_MANUAL_ONLY | tournament archived; would burn ~2,500/month in Jun–Jul |
| deploy-pages / sync_version | push / dispatch | 1 min × 158 / 19 | KEEP_IN_GITHUB | Pages deploy not the target (free on standard runners per GitHub docs as relayed by Eduardo; unverified here) |
| safety_check | PR + push to main | **11.5 min × 126** | KEEP_IN_GITHUB but **trim** (see levers) | second-largest block; `npm run check` is already mandatory locally |
| 17 operator/test workflows | dispatch only | ~0–16 runs | MAKE_MANUAL_ONLY (already) | no recurring cost |

## Monthly model (30-day month)

| Block | CURRENT, repo public | PRIVATE, before migration (Oct) | PRIVATE, after relay migration |
|---|---:|---:|---:|
| live_cache_producer (scheduled production) | 0 (free) | **≈ 11,300** (Sep 14,000 · Aug 17,000) | **0** |
| GitHub Pages deploy + cache-bust | 0 | 177 | 177 |
| CI / PR (`safety_check`) | 0 | 1,449 | 1,449 |
| Scheduled production (snapshot, EPG, lottery, jackpot, receipts) | 0 | 859 | 859 |
| Emails / operators (result, round, powerball, manual) | 0 | 464 | 464 |
| Monitoring (monitor, schedule_watch, sentinel, watch, coverage) | 0 | 434 | 434 |
| **Total** | **0 billed** (≈ 12 k used) | **≈ 14,700** | **≈ 3,400** |
| After cheap levers (below) | | | **≈ 1,850** |

Producer share of private-repo minutes today: **~77 %**. Cheap levers, each independent and none touching business logic:
(0) restrict the Worker cron to `*/5 0-2,14-23 * * *` — **−3,960 min** even if nothing else is migrated (wrangler change + Worker redeploy);
(1) `safety_check`: run on PRs only when code paths changed, and not on push to `main` (~−1,300);
(2) `live_pipeline_monitor` cron limited to the match window (~−80); (3) retire `cdb2026_schedule_watch` schedule (−149), `br2026_broadcast_coverage` manual (−24).

## What "near-zero recurring production runner use" realistically means

After the relay cutover, *recurring producer* minutes = 0. Remaining scheduled production in the private repo (~860 + emails ~460 + monitoring ~430)
is ~1,750 min/month — **below Pro's 3,000 but not below Free's 2,000 once CI is added**. Getting the rest near zero needs moving ESPN/EmailJS jobs
out of GitHub, which requires an egress answer for ESPN and handling of private participant data off-GitHub: separate decisions, not this change.
