# Live provider cutover runbook (API-Football, no recurring GitHub runner)

**Nothing here has been executed.** No deploy, merge, purchase, secret, DNS or visibility change was made. Pre-reading: `PIPELINE_TOPOLOGY_CORRECTION.md`, `EXECUTION_LOCATION_EVALUATION.md`, `API_FOOTBALL_PROVIDER_ASSESSMENT.md`.

## Authority and invariants (read first)
- **Authority rule:** exactly one system writes `live_sports_cache` at any time. Until step 5 that is the ESPN/GitHub producer. The API-Football path runs **dry (`dry_run=1`) and writes nothing** until it is made authoritative. There is **no dual-writer phase**.
- Same table, same key (`competition`), same envelope (`buildGatewayPayload`), same last-known-good rules and 10-minute gateway cap; a provider failure (401/429/5xx/`errors`/bad shape) never writes.
- Rollback never needs a code change: flip `PRODUCER_MODE` / re-enable the old Worker cron.

## A. Live egress + coverage proof (do first; Free key only; no paid plan)
Goal: answer, with HTTP status codes only, (1) can Cloudflare reach api-sports.io, (2) can Supabase, (3) are Série A and Copa do Brasil 2026 covered, (4) does the real payload match the adapter. **Do not deploy probes without Eduardo's go.**
1. Create a **Free** API-Football account (100 requests/day); store the key as a secret only. Budget per probe ≈ 3 requests.
2. *From a laptop* (control): `GET /leagues?id=71&season=2026`, `GET /leagues?id=73&season=2026`, `GET /fixtures?live=71-73`. Record: HTTP status, `errors` keys, `results`, the `coverage` flags and season window. If the free plan cannot read 2026 → STOP: Pro is required before any further proof (decision for Eduardo). Save the **real JSON of a live and of a finished fixture** (redact nothing sensitive; it is public sports data) as new fixtures for the adapter tests and diff against the adapter's assumptions.
3. *From Cloudflare*: a throwaway Worker `egress-probe` (separate name, no cron, `workers_dev` only for the probe, deleted afterwards) calling the same three endpoints with the key as a secret; log **status code, `content-type`, `errors` keys, `results` count and presence of `x-ratelimit-*` headers — never the body or key**. Repeat from 2 invocations (different colos).
4. *From Supabase*: a throwaway Edge Function with the same logic (status codes only), invoked twice.
5. Decision table: CF 200 → Option A. CF blocked and Supabase 200 → Option B (add `pull` mode). Both blocked → Option C/D. A 200 with `errors`/empty `response` for a Brazilian league → coverage FAIL.
6. Delete the probes; revoke nothing else.

## B. Shadow (read-only) — ESPN stays authoritative
1. Merge this branch (Eduardo). **Merging `supabase/functions/**` auto-deploys `live-cache-ingest`** (inert: 503 without secret). Remove `CHANGE_INTENT.json` after merge (check D3). Confirm `x-deploy-sha` of `live-football` is unchanged.
2. Set Supabase secret `LIVE_INGEST_TOKEN` (random, never in chat/logs). Smoke: wrong token → 401; right token `GET ?plan=1&provider=api_football` → JSON plan.
3. Deploy `workers/live-producer-direct` with secrets `API_FOOTBALL_KEY`, `LIVE_INGEST_TOKEN`, `PRODUCER_MODE=shadow`, `OBSERVATIONS_PER_TICK=1`. (Plan check first: Workers Free CPU for cron = 10 ms; if the first invocations hit CPU limits, move to the $5 plan.) The existing `workers/live-producer` keeps dispatching GitHub, untouched.
4. During **at least one real match** (ideally one per competition, plus one postponed/idle day): compare, per minute, the dry-run `results[*].live/matches/unmapped` and the Worker log against the gateway body written by the ESPN producer (`GET live-football?competition=…`). Quantify: (a) score-change latency — time between the provider showing a goal and ESPN showing it; (b) status transitions (HT, 2H, FT) latency; (c) `unmapped` fixtures (fill `identityMap`/aliases from the real response); (d) own-goal `details.team` convention vs ESPN; (e) any mismatch in final score. **Accept** when no unexplained score/status mismatch remains over ≥ 2 matches, `unmapped` = 0 for every fixture in the window, and median latency ≤ ESPN's.
5. Free quota limits shadow to ≈ 100 requests: one match at 90 s. Anything more realistic (60 s, both leagues, several matches) needs **one month of Pro** — a purchase for Eduardo to authorize; I did not.

## C. Cutover (authoritative)
Do in one short window with no live match, in this order (gaps up to ~10 min are invisible: gateway FRESH ≤ 10 min, usable ≤ 30 min):
1. **Stop the old writer first:** deploy `workers/live-producer` with `"crons": []` (or delete it) → Cloudflare stops dispatching GitHub. In the same change remove the `schedule:` block from `live_cache_producer.yml` (scheduler A) — keep `workflow_dispatch` for manual emergency use; update `test_live_producer_cadence.mjs`/`cron_coverage` accordingly (their expectations encode the old schedule).
2. **Then** set `PRODUCER_MODE=authoritative` on `live-producer-direct`. Order matters: stopping before starting guarantees no two writers.
3. Verify within 2 minutes: Worker log `OBSERVADO`, function log `WRITTEN`, `GET live-football` `x-live-health: FRESH`, `ageSeconds` small.
4. Observe ≥ 48 h including a match day: no `pipeline-incident` Issue; `live_pipeline_monitor` OK; quota remaining (`MIN_REMAINING_REQUESTS` guard) healthy; GitHub Billing → Usage: `live_cache_producer` ≈ 0 minutes.
5. After the observation period: delete the workflow's `workflow_dispatch` inputs-driven production path or keep it manual-only (ESPN producer retained for emergency comparison); retire `workers/live-producer`.

## D. Rollback (any time)
- Before C: nothing to roll back (shadow writes nothing). Set `PRODUCER_MODE=off`.
- After C: set `PRODUCER_MODE=off` on the direct Worker **first**, then redeploy the old Worker cron and restore the `schedule:` only if wanted; the old workflow is unchanged and resumes on the next dispatch (≤ 5 min; the cache serves last-known-good meanwhile).
- Quota exhaustion/AUTH/429: the Worker stops itself (`PARADO`); the gateway degrades honestly to SOURCE_UNAVAILABLE after 30 min; fall back to the ESPN producer by re-enabling the old Worker.

## E. External actions required (none done)
Free API-Football account; (maybe) Pro month; Supabase secret `LIVE_INGEST_TOKEN`; Worker secrets + deploy; probe Workers/functions; Workers plan check; merge; later the privacy decision. **ToS of API-Football (caching/redistribution) must be read before step C.**
