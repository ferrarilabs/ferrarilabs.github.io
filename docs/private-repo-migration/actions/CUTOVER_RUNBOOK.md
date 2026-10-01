# Cutover runbook — live producer off private-repo minutes

**Nothing here has been executed.** No Worker/function deploy, no merge, no secret, no visibility change was made by the branch that adds this file.
Pre-reading: `LIVE_PIPELINE_TRACE.md`, `EXECUTION_LOCATION_EVALUATION.md`.

## Invariants for every step
- One canonical implementation: `supabase/functions/_shared/live_ingest_core.js` (used by `produce_live_cache.mjs` today and by `live-cache-ingest`).
- Only table written: `live_sports_cache`, key `competition`. Failed/invalid observation never writes (last-known-good preserved, 10-min gateway cap untouched).
- **No dual writer without idempotency proof.** Both writers upsert the same key with a fresh `observed_at` and byte-identical envelopes for the same raw body
  (test: "UMA implementação" in `bolao/shared/scripts/test_live_ingest.mjs`). Last write wins; the worst interleaving is a ≤15 s older observation overwriting a newer one.
  Still, Steps 3–4 never let both *write*: shadow = `dry_run`.

## Step 0 — no-regret quick win (independent, optional)
Worker cron `*/5 * * * *` → `*/5 0-2,14-23 * * *` in `workers/live-producer/wrangler.jsonc`, then `wrangler deploy`. Saves ~3,960 min/month; the producer already skips 03–13 UTC. Gate to update with it: `bolao/scripts/test_live_producer_cadence.mjs`.

## Step 1 — deploy the new path (inert)
1. Merge this branch (Eduardo). **Merging `supabase/functions/**` auto-deploys `live-cache-ingest` via the Supabase GitHub integration.** It is inert: without `LIVE_INGEST_TOKEN` it answers 503. Remove `CHANGE_INTENT.json` after merge (check D3).
2. Confirm: `curl -s -o /dev/null -w '%{http_code}' -X POST '<SUPABASE>/functions/v1/live-cache-ingest?competition=br2026'` → **503**; with a wrong token (after step 3) → 401. Confirm `x-deploy-sha` of `live-football` is unchanged (this branch does not modify its files).
3. Generate a long random token; set Supabase secret `LIVE_INGEST_TOKEN` (`supabase secrets set …`, value never in chat/logs).

## Step 2 — create the public relay repo
New public repo (e.g. `ferrarilabs/live-relay`) containing exactly `infra/live-relay/` (3 files). Repo variable `INGEST_URL`, secret `LIVE_INGEST_TOKEN` (same value). No `pull_request` trigger exists, so forks never see secrets. Disable Actions' "run workflows from fork PRs" defaults as hygiene. Fine-grained PAT for the Worker: Actions:write on **this new repo only**.

## Step 3 — shadow (read-only): relay in dry run
Dispatch `live-relay` manually with `dry_run=true` (default) during a live match. Expected logs: `ingest HTTP 200 DRY_RUN <n> ativa=true`. Nothing is written. Compare, for the same minute: `matches` count and live states from the relay response vs the gateway body the old producer wrote (`GET live-football?competition=br2026`). Accept when they agree for ≥ 2 live matches across both competitions and ≥ 1 idle period.

## Step 4 — compare freshness
Record, for one match day, `ageSeconds` of the gateway body written by the old producer (expect ≤ ~20 s with the 15 s loop). Then do **one short controlled overlap**: dispatch the relay once with `dry_run=false` while the old producer keeps running, to prove the interleaving is harmless (envelopes identical, `observedAt` monotone within ~15 s). Abort and roll back if the served `ageSeconds` ever exceeds 60 s or the shape differs.

## Step 5 — switch the scheduler
Worker vars (wrangler.jsonc): `GH_REPO` → `ferrarilabs/live-relay`, `GH_WORKFLOW` → `relay.yml`; update `worker-configuration.d.ts` literals and `test_live_producer.mjs` expectations in the same commit; swap the Worker secret `GH_DISPATCH_TOKEN` to the new PAT. `wrangler deploy`. The dispatch body sends `dry_run:"false"`, so the relay now writes.
**The old workflow must not also be dispatched** — the Worker has one target, so switching the vars *is* the disabling of the old 5-minute dispatch. The old `live_cache_producer.yml` keeps its own `schedule:` (`*/5 14-23,0-2`) which GitHub runs sporadically (median 25 min): **remove that schedule in the follow-up PR** (a leftover scheduled run is a second, billed, unwanted writer).

## Step 6 — observe (≥ 48 h incl. a match day)
Worker log: `DISPARADO` every cron tick (a `RECUSADO dispatch http 404` = PAT scope). Relay runs green; function log `status 200 action WRITTEN`. `live_pipeline_monitor` stays OK/CACHE_STALE; no `pipeline-incident` Issue. Settings → Billing → Usage: private-repo Actions minutes for `live_cache_producer` ≈ 0.

## Step 7 — decommission
PR: delete the `schedule:` block of `live_cache_producer.yml` (keep `workflow_dispatch` as break-glass), update `test_live_producer_cadence.mjs`/`cron_coverage` accordingly, mark the old path in `docs/bolao/ARCHITECTURE.md`.

## Rollback (any step)
- Before Step 5: nothing to roll back; delete the relay repo / unset `LIVE_INGEST_TOKEN` (function returns 503 again).
- After Step 5: restore Worker vars `GH_REPO`/`GH_WORKFLOW` and the old PAT, `wrangler deploy` (≈ 1 minute); the old workflow still exists unchanged and resumes immediately. Cache keeps serving last-known-good (≤ 10 min FRESH, ≤ 30 min STALE_BUT_USABLE) during the swap.
- Disable the function path entirely: unset `LIVE_INGEST_TOKEN`.
- Emergency: `gh workflow run live_cache_producer.yml -f dry_run=false` still works (bills private minutes).

## What must be decided / provided by Eduardo (external)
Accept the Actions-ToS gray area or choose a self-hosted runner (then point `INGEST` relay at it, same function); create the public repo, secret, PAT; authorize merge (deploys the inert function); Worker redeploys; confirm account plan/allowance in Billing.
