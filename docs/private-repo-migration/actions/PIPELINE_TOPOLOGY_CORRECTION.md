# Correction: the live producer has TWO active schedulers

Verified against `origin/main` @ `49ccea2e` (2026-10-01) and against 8,757 real run records (2026-09-01 → 2026-10-01).

## What the code says (both are on `main` today)

| # | Scheduler | Where | Fires | Effect |
|---|---|---|---|---|
| A | GitHub `schedule:` | `.github/workflows/live_cache_producer.yml` L52–54: `*/5 14-23 * * *`, `*/5 0-2 * * *` | nominal 156 runs/day, **delivered ≈ 4.7/day** (GitHub throttles/delays it; median 25–34 min per earlier measurements) | starts a `produce_live_cache.mjs --loop` run |
| B | Cloudflare Cron → `workflow_dispatch` | `workers/live-producer/wrangler.jsonc` L41: `*/5 * * * *` (24 h/day) | 288/day, near-exact | starts the same workflow through the REST API |

The workflow comment ("NAO existe agendamento fora da janela") predates #369: B was added later as the reliable clock and **A was never removed**. Both are active: A shows up as `event=schedule` runs, B as `event=workflow_dispatch`.

## How they interact (concurrency)

`concurrency: { group: live-cache-producer, cancel-in-progress: true }` — a static group, shared by every event type. Any new run cancels the in-progress run **and** any pending one in the group. The producer's in-window loop (5m30s) is *designed* to be cut by the next dispatch.

Measured (Sep 1 → Oct 1): dispatch 8,612 runs, 11.6 % cancelled (958 of the 1,002 were followed by another dispatch = the designed hand-off); schedule 145 runs, **28.3 % cancelled** (all 41 had a dispatch start inside their window); 153 dispatch runs overlapped a schedule run and 73 of those were cancelled by it. So a stray scheduled run does not double the work: it replaces the in-flight dispatched run (a ~12 s runner start-up gap at worst) and is itself replaced ≤ 5 min later. There is no dual *writer* hazard (same table key, same envelope, last write wins) — but it is redundant scheduling that costs minutes and adds noise.

29 of 145 scheduled runs started outside 14–02 UTC (03–05 and 16–17 UTC): delivery delay, not a third cron.

## Minutes by source (measured; billed ≈ ceil(duration/60), min 1)

| Source | Runs / 30 d | Billed min / 30 d | Share |
|---|---:|---:|---:|
| B dispatch (Cloudflare) | 8,334 | ≈ 13,145 | 98.3 % |
| A schedule (GitHub) | 140 | ≈ 224 | 1.7 % |
| **Producer total (Sept, measured)** | | **≈ 13,370** | |

Runs ≥ 120 s (the in-window loop): 1,005 dispatch (982 cancelled by design) ≈ 5,954 min — 5.9 min each, which validates the "6 billed minutes per in-window run" assumption. The remaining ~7,600 dispatch minutes are 15-second runs that bill 1 minute and do nothing (out of window).

## Was the earlier 14,700-minute model wrong?

It was **right in magnitude, incomplete in structure**: it modelled the Worker's 24 h dispatch from the calendar (Sept model 13,970 vs measured 13,583 — within 3 %) but did **not** include scheduler A (+224 min). Corrected October private-repo total: 14,898 min (was 14,675). The first audit's "~8,640" was lower because it ignored the in-window loop (6 min/run).

## Classification

Scheduler A is **redundant scheduling**, confirmed. Not disabled by this change (instruction: do not disable either yet). Retiring A is a one-line change (remove the `schedule:` block) and belongs to the cutover runbook, step 7, together with the Worker's dispatch.
