# SLO — Honest Numbers, Two Options (item 9)

No 5-minute guarantee is claimed against the current GitHub Actions cron. This corrects the
earlier pass's overclaim (checkpoint D's report said "5-minute SLO," validated only against a
fake-clock test suite, never against the real cron topology).

## Current state: GitHub Actions cron

Tightest existing production cron: `cdb2026_result_emails.yml`, `*/10 16-23,0-5 * * *` (every 10
minutes during the live-match window).

| Factor | Value |
|---|---|
| Cron interval | 10 minutes |
| GitHub Actions scheduling delay | Documented by GitHub as "may be delayed," no SLA — assume 0-5 min under load |
| Provider fetch (ESPN) | `fetch_json()` timeout 10s + retries — worst case ~30s |
| Per-recipient EmailJS throttle | `time.sleep(3)` per recipient — for N real recipients, 3×N seconds (CDB2026 currently ~15 entries → ~45s) |
| Retry backoff (if wired into a real cron, not done in this branch) | none in the real cron path today — `send_result_email.py --auto` either succeeds this tick or waits for the next one |

**Best case**: result lands right as a cron tick starts — confirmed and notified within roughly
1 minute (fetch + throttle cost only).

**Realistic worst case**: result lands the instant after a tick fires — waits a full 10-minute
interval, plus up to 5 minutes of possible scheduling delay, plus ~45s of throttle cost for a
real recipient count → **approximately 10-16 minutes**, not 5.

**Operational target for Option A: 10-16 minutes**, not 5.

## Option A — Keep GitHub Actions, tighten the interval

Reduce the cron interval (e.g. `*/5` instead of `*/10`) during live windows. Realistic target
then becomes **~5-11 minutes** worst case (half the wait window, same scheduling-delay and
throttle costs). GitHub Actions has **no absolute platform guarantee** on cron timing at any
interval — this narrows the target, it does not eliminate the uncertainty.

## Option B — Supabase Cron / Edge Functions (proposal, not implemented)

Supabase's own `pg_cron` (or Edge Functions on a schedule) could run inside the same database
transaction boundary as the notification-job claim, removing the GitHub Actions
scheduling-delay variable entirely and enabling a much tighter interval (e.g. every 1 minute)
without GitHub Actions run-minute cost. **This is presented as a proposal only** — nothing in
this branch implements it. It would require: moving the ESPN-fetch step somewhere Supabase can
reach it (Edge Function with outbound fetch, or a still-GitHub-Actions-driven provider step
feeding Supabase), and its own dedicated design/review before any real schedule uses it.

## Recommendation

Do not promise a 5-minute SLO on the current architecture. If tighter timing is required,
Option A (tighten the existing cron interval) is the lower-risk near-term change; Option B is a
real architecture change that deserves its own proposal and review, not a silent addition to
this already-large branch.
