# Live cache pipeline — exact trace (Phase 1)

Evidence: `.github/workflows/live_cache_producer.yml`, `workers/live-producer/{src/index.ts,wrangler.jsonc}`,
`bolao/shared/scripts/produce_live_cache.mjs`, `supabase/functions/{live-football,_shared/*}`, `bolao/shared/js/football_live_store.js`,
`.github/workflows/live_pipeline_monitor.yml`. Measurements quoted below are the ones recorded in those files' comments
(2026-08-21 → 2026-08-28); this session could not re-measure them (no deploy, no access to Cloudflare/Akamai egress).

## Sequence (today)

```
Scheduler B: Cloudflare Cron  */5 * * * *  (24 h/day, wrangler.jsonc — NOT limited to the 14–02 UTC window)
(+ Scheduler A: GitHub `schedule:` */5 14-23 and */5 0-2 on the same workflow, delivered ≈4.7×/day — see PIPELINE_TOPOLOGY_CORRECTION.md)
   │ scheduled() → dispararProdutor()      Worker holds ONLY GH_DISPATCH_TOKEN (Actions:write), no DB key (ADR-021)
   ▼
GitHub REST  POST /repos/ferrarilabs/ferrarilabs.github.io/actions/workflows/live_cache_producer.yml/dispatches  {ref:main}
   ▼
GitHub Actions runner (ubuntu-latest, timeout 7 min, concurrency live-cache-producer, cancel-in-progress)
   │ checkout → setup-node → node produce_live_cache.mjs --loop     (secret: SUPABASE_SERVICE_ROLE_KEY)
   │   every 15 s for ≤ 5m30s (cancelled by the next dispatch at ~5 min):
   │   for competition in [br2026, cdb2026]:
   │      window check  ← bolao/<app>/data/espn-normalized.json dates, [-3h, +1h]; none in window → exit after 1 pass (~16 s)
   ▼
ESPN  GET https://site.api.espn.com/apis/site/v2/sports/soccer/{bra.1|bra.copa_do_brazil}/scoreboard   (200 only from a GitHub runner)
   ▼
TRANSFORM  validateScoreboardShape → normalizeScoreboard → buildGatewayPayload     (supabase/functions/_shared/normalize.js, pure ESM)
   ▼
STORAGE  POST {SUPABASE}/rest/v1/live_sports_cache  Prefer: resolution=merge-duplicates  key = competition   (service role; anon INSERT revoked by migration 011)
   ▼
CONSUMERS
   · Edge Function live-football (gateway): reads live_sports_cache with the anon key, classifies freshness
     (FRESH ≤10 min, STALE_BUT_USABLE ≤30 min, else SOURCE_UNAVAILABLE; freshness_contract.js), serves JSON + x-live-health
   · Browser (football_live_store.js in br2026/cdb2026): polls the gateway (~60 s), falls back to the committed snapshot
   · live_pipeline_monitor.yml (hourly, :17): probes gateway, opens/updates/closes an Issue; Sentinel live-deploy-drift detector
```

## Why a GitHub runner sits in the middle (not assumed — read from the code)

1. **Egress, only.** `live_cache_producer.yml` header and `workers/live-producer/src/index.ts` record: ESPN (Akamai, `AkamaiGHost`,
   "Access Denied") returns **403 to Supabase Edge Runtime and to Cloudflare Workers** — by datacenter IP, not by headers (3 header
   variants tried; Worker v1 fetched ESPN directly and got 403 on every run, 2026-08-28). The same URL returns 200 from a GitHub runner.
2. **Not** for compute: the transform is pure ESM with no `node:`/`Deno` imports (`normalize.js`, `gateway_core.js`) and already runs in Deno.
3. **Not** for cadence: GitHub's own `schedule` was measured at median 25–34 min for a `*/5` cron, which is why Cloudflare Cron became the clock (#369).
4. **Not** for the database: the write is a plain PostgREST upsert.

So the pipeline needs exactly one thing from the runner: **one HTTPS GET to ESPN from an IP Akamai accepts.** Everything else is portable.

## Cost mechanics that matter for a private repo

- The Worker dispatches **24 h/day**, but the producer only has work in the match window. Out-of-window runs finish in ~16 s but bill **1 minute each**.
- In-window runs use `--loop` (#381): the runner stays alive ~5 min observing every 15 s and is cancelled by the next dispatch → ~5m12s → **6 billed minutes**, i.e. a runner that is busy continuously on match days.
- Measured (Sept 2026, 8,757 runs): ≈ 13,370 billed min/30 d (dispatch ≈ 13,145 + schedule ≈ 224). Model (`scripts/actions_minutes_model.mjs`, calendar in repo): Oct ≈ 11,500, Sep ≈ 14,200. Higher than the first audit's "~8,640", which counted dispatches × 1 min and ignored the in-window loop.
