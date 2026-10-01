# Where the live producer runs, with what provider, at what cadence (supersedes the relay proposal)

**Decision input (2026-10-01):** an independent ToS review rejected a public GitHub repo + free GitHub-hosted runners as a recurring production relay. That proposal is **REJECTED** and removed (`infra/live-relay/` deleted). Target: **no recurring GitHub-hosted runner is needed to keep live scores fresh.** GitHub Actions stays for CI, tests, deploy, Pages and manual operator jobs.

## 1. Architecture (implemented, inert, not deployed)

```
Cloudflare Cron (1 min)  ── workers/live-producer-direct (NEW; PRODUCER_MODE=off|shadow|authoritative)
   │ 1. GET  live-cache-ingest?plan=1        ← the FUNCTION decides (calendar + cache) whether anything can be live, and which calls to make
   │ 2. GET  API-Football /fixtures?live=71-73 (+ /fixtures?league=…&from=…&to=… day sync every 10 min)   ← provider key lives only in the Worker
   │ 3. POST live-cache-ingest?provider=api_football&kind=…   (raw body, dry_run=1 in shadow)
   ▼
Supabase Edge Function live-cache-ingest   (token auth, 503 without secret; service role stays here)
   │ validate envelope → adapter (providers/api_football.js) → canonical matches (ids from the committed calendar)
   │ → merge into current record → buildGatewayPayload (same envelope as the gateway) → upsert live_sports_cache
   ▼
live-football gateway ─► browsers (unchanged)          ESPN/GitHub producer stays authoritative until cutover
```
Module layout (provider-neutral core, one normalization): `supabase/functions/_shared/{live_ingest_core.js, polling_plan.js, providers/espn.js, providers/api_football.js}`. The ESPN producer (`produce_live_cache.mjs`) now calls the same core, with identical output (18/18 existing tests).

## 2. Options, in the requested order

**Option A — existing Cloudflare Worker: PREFERRED; NEEDS LIVE EGRESS TEST.** Cloudflare cannot reach ESPN (Akamai, measured 403), but API-Football is a commercial API with keys; nothing indicates it blocks Workers — and nothing proves it doesn't. I implemented it as a *new* Worker (`workers/live-producer-direct`) rather than editing `workers/live-producer`, whose gates encode "no ESPN, no ingest token, 5-minute cron" for the path that must keep running. The new Worker never holds a DB credential (ADR-021 preserved): it holds the provider key and an ingest token that only works on one endpoint.
Runtime facts (Cloudflare docs via the research pass; **plan UNVERIFIED** — `workers_get_worker` exposed name/id only): cron minimum 1 min on Free and Paid; wall time 15 min per cron invocation; **CPU per cron invocation Free 10 ms, Paid 30 s**; subrequests per invocation Free 50, Paid 10,000; waiting on `fetch` is not CPU. This Worker does almost no CPU (forwards text, never parses the provider body), so 60 s baseline is plausible even on Free (unproven — the 10 ms cap is the risk). **Fast mode** (`OBSERVATIONS_PER_TICK` > 1 with `scheduler.wait`) is implemented and tested but must not be enabled until the plan is verified: Free allows ≤ ~50 subrequests/invocation (≈ 8 observations at 3–6 calls each), and I could not confirm that `scheduler.wait` is permitted in a scheduled handler.

**Option B — Supabase scheduled Edge Function (pg_cron + pg_net): NEEDS LIVE EGRESS TEST.** Supabase supports sub-minute `pg_cron` (`'30 seconds'`), `pg_net.http_post`, and Edge Functions with 150 s (Free) / 400 s (Pro) wall, 2 s CPU. The ESPN/Akamai block of Supabase egress says nothing about api-sports.io. If A's egress fails but B's passes, the same core is reused by adding a `pull` mode to `live-cache-ingest` (fetch the provider itself with `API_FOOTBALL_KEY`) — not implemented, to avoid a speculative second code path. Costs: it puts the provider key in the same runtime as the service role (against the project's separation principle), so A is preferred.

**Option C — another scheduled runtime:** only if A and B fail egress; candidates (a self-hosted runner, a small VM) need their own egress proof. **Not a public GitHub repo.**

## 3. Cadence — what the UX goal costs (calendar-derived, `scripts/live_request_budget.mjs`)
One `live=71-73` call covers both competitions; day sync adds 1 call/competition/10 min. Oct–Dec 2026 has only **18 days with a plausible live window** (4,636 active minutes).

| Cadence | Typical match day | Busy day (p90) | Worst day (Oct 11) | Oct / Nov / Dec | Free 100/day | Pro 7,500/day |
|---|---:|---:|---:|---|---|---|
| 60 s | 266 | 462 | 565 | 2,986 / 1,596 / 532 | no (proof only) | 8 % |
| 30 s | 507 | 882 | 1,077 | 5,694 / 3,042 / 1,014 | no | 14 % |
| 15 s | 989 | 1,722 | 2,101 | 11,110 / 5,934 / 1,978 | no | 28 % |

If the calendar is uncertain (as the committed snapshots are *today*: stale since Sep 10/15) the plan falls back to a 12:00–03:59 UTC window = 960 min/day → 3,840 req/day at 15 s: still inside Pro. **Free (100/day) cannot run a match day** — at 60 s it covers ~100 minutes of a single day; use it for the egress/coverage proof and at most one shadow match.

**Latency (end to end, worst case)** = provider lag (UNVERIFIED; ~15 s claimed) + producer cadence + gateway TTL 15 s + browser poll 60 s. Today's ESPN loop: 15 + 15 + 60 ≈ **90 s** (+ ESPN lag). API-Football at 60 s: ≈ 60 + 15 + 60 ≈ **135 s**; at 30 s ≈ **105 s**; at 15 s ≈ **90 s**. All are far better than the pre-#381 3–5 min; the 60 s browser poll is the floor, so going below 30 s buys little. **Cheapest cadence that meets "substantially faster than 3–5 min": 60 s baseline (≈ 2 min worst case, 8 % of Pro on the worst day). 30 s is the sensible upgrade once the Worker plan is verified.**

## 4. Never poll when nothing can be live (`polling_plan.js`)
Windows are derived per fixture from the committed calendar ([-3 h, +1 h]; postponed/cancelled ignored). Safeguards: (i) a match already `in` in the cache keeps polling regardless of hour; (ii) a fixture the calendar still shows as not finished stays "possibly live" for 5 h (extra time, delays, unreflected postponements); (iii) **calendar missing/empty/unparseable/older than 7 days ⇒ wide fallback window 12:00–03:59 UTC — fail toward fetching, never silence** (a superset of today's 14–02 window, tested hour by hour); (iv) a live match that disappears from `live` triggers a day sync, not an invented final. The window logic lives in the function, so refreshed calendars/postponements take effect without redeploying the Worker. Residual risk: a postponement not yet in the calendar costs a few wasted polls; a kickoff moved *earlier* by > 1 h would be missed until `live` is polled by the fallback — acceptable and visible in shadow.

## 5. Cost comparison (monthly; GitHub figures are the repo-wide model for October, overage at the $0.006/min Linux rate quoted in GitHub's billing docs — pricing pages not re-fetched here)

| | A. Private + current producer | B. Private + optimized GitHub producer | **C. API-Football Pro + Worker/ingest** | D. Self-hosted runner (private repo) |
|---|---|---|---|---|
| Fixed | plan fee | plan fee | **$19** (+ $0 Workers Free / $5 Paid) | host ($0–5) |
| Metered | ≈ 14,900 min → ≈ 11,900 over 3,000 allowance ≈ **$71** | ≈ 6,565 min (window-only dispatch) ≈ **$21**; with CI levers ≈ $12 | none for the producer; remaining workflows ≈ 3,400 (≈ 1,850 with levers) ≈ $0–2 | none |
| Complexity | low (today) | medium (calendar-driven dispatch from a Worker with no calendar) | medium (new Worker + function + secrets) | medium (host upkeep) |
| Dependency risk | ESPN/Akamai, GitHub schedule | ESPN/Akamai | **new paid provider; coverage UNVERIFIED; identity still ESPN-anchored** | host + ESPN egress UNVERIFIED |
| ToS risk | none *if billed* | none | provider terms UNVERIFIED | none |
| Score latency | ≈ 90 s | ≈ 90 s | ≈ 135 s (60 s) / 105 s (30 s) | ≈ 90 s |
| Failure domain | GitHub runner pool + Cloudflare clock | same | Cloudflare + Supabase + api-sports | the host |

Not chosen on sticker price: **B is cheaper to switch to and keeps ESPN's coverage evidence, but it keeps a recurring GitHub runner on the live path** — the explicit non-goal. **C satisfies the target** but is not provable from the repo: it needs the live egress/coverage proof. Recommendation: pursue C through the proof plan; if Cloudflare or Supabase egress or coverage fails, D (self-hosted runner executing the existing ESPN producer) is the fallback that preserves the current data source without billed minutes; B (+ removing scheduler A) is the stop-gap if neither is ready when the repo goes private.

## 6. Disposition of the previous (relay) pass
| File | Verdict |
|---|---|
| `infra/live-relay/{relay.mjs,.github/workflows/relay.yml,README.md}` | **DELETE** (done) — public-repo relay rejected |
| `supabase/functions/_shared/live_ingest_core.js` | **REPURPOSE** — rewritten around provider adapters; ESPN `buildCacheRecord` kept for the GitHub producer |
| `supabase/functions/live-cache-ingest/` + `config.toml` entry | **KEEP, repurposed** — narrow token-gated ingest for the API-Football push; ESPN push removed |
| `bolao/shared/scripts/test_live_ingest.mjs` | **REPURPOSE** — relay tests deleted; handler, merge, plan and parity tests |
| `produce_live_cache.mjs` delegating to the core | **KEEP** |
| `scripts/actions_minutes_model.mjs`, gate registrations, `CHANGE_INTENT.json`, worker-isolation allowlist | **KEEP / extended** |
| `docs/.../EXECUTION_LOCATION_EVALUATION.md`, `CUTOVER_RUNBOOK.md` | **REWRITTEN** (this file; runbook) |
