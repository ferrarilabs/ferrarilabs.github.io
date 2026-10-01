# Live provider proof — FREE phase (runbook)

Status of this phase when written: **BLOCKED — no `API_FOOTBALL_KEY` available** (checked: unset; no `.env`). No network call was made. Everything here is prepared, offline-checked, and ready; nothing is deployed. Branch `chore/private-repo-actions-migration` @ `29e308eb`, `origin/main` `49ccea2e` (no divergence), tree clean when started.

## 0. Get the key (Eduardo, no purchase)
API-Football dashboard → **Account → My Access** → copy the API key. Create the Free account if needed (100 requests/day). Export it in your shell only: `export API_FOOTBALL_KEY=...` (never in a tracked file; `.proof-out/` is git-ignored).

## 1. Local proof (≈ 9 calls, hard cap 20) — answers items 3, 4, 5
```bash
cd ~/Documents/GitHub/ferrarilabs-actions-private-migration
node scripts/proof/api_football_free_proof.mjs        # prints sanitized per-call JSON + summary; saves public fixtures to .proof-out/
node scripts/proof/adapter_on_real_payload.mjs        # offline: real payload → adapter → canonical + ESPN-id reconciliation
```
Calls made: `/status` (1), `/leagues?country=Brazil` (1, discovery — ids are NOT assumed), `/leagues?id=<id>&season=2026` per competition (2), `/fixtures?league=<id>&season=2026&last=2|next=2` per accessible competition (≤ 4), `/fixtures?live=<idA>-<idB>` (1, only if both seasons are accessible). Classification per competition: `CONFIRMED_2026_ACCESS` / `FREE_PLAN_SEASON_BLOCKED` (HTTP 200 with a plan/season `errors` entry) / `COMPETITION_NOT_FOUND` / `OTHER_ERROR`. If both are `FREE_PLAN_SEASON_BLOCKED`, 2026 cannot be tested on Free: the outcome is **API-FOOTBALL PRO ONE-MONTH SUBSCRIPTION REQUIRED TO TEST 2026** (Eduardo's decision; not bought here). If no match is live at run time, the live query is still tested for structure and filtering, but there is no live payload — do not fabricate one.
After it runs, if the real league ids differ from 71/73 or the real fields differ from the adapter, edit `LEAGUES`/the adapter and add the captured payloads as test fixtures before any further phase.

## 2. Cloudflare egress probe (disposable) — item 7
Uses the existing Cloudflare session on Eduardo's machine; a separate Worker name, no cron, no Supabase, no DB credential; the existing `ferrarilabs-live-producer` is untouched. Exactly 2 provider calls.
```bash
cd scripts/proof/probes/cloudflare-egress-probe
npx wrangler secret put API_FOOTBALL_KEY      # paste; value is never echoed
npx wrangler secret put PROBE_TOKEN           # any random string
npx wrangler deploy
# in another terminal, for CPU/wall evidence:  npx wrangler tail ferrarilabs-egress-probe-tmp --format json
curl -s -H "x-probe-token: $PROBE_TOKEN" "https://ferrarilabs-egress-probe-tmp.<account>.workers.dev/?path=/leagues%3Fid%3D<ID>%26season%3D2026"   # call 1
curl -s -H "x-probe-token: $PROBE_TOKEN" "https://ferrarilabs-egress-probe-tmp.<account>.workers.dev/"                                          # call 2 (different colo/instance if possible)
npx wrangler delete ferrarilabs-egress-probe-tmp
```
Record: `providerStatus`, `looksLikeProviderJson`, `errorsKeys`, `wallMs`, `cf.colo`, `ratelimit`; **CPU time** from the `wrangler tail`/Workers Logs invocation outcome (`cpuTime`) — the probe cannot measure CPU itself. Compare with the Free-plan 10 ms CPU cap for cron invocations (research pass; plan UNVERIFIED): note the probe is an HTTP fetch handler, a cron invocation of the real Worker will do a similar fetch plus a small JSON read. **Do not recommend Cloudflare Paid unless the measured CPU is actually near/over the cap.**

## 3. Supabase egress probe (disposable) — item 8
```bash
cp scripts/proof/probes/supabase-egress-probe/index.ts supabase/functions/egress-probe-tmp/index.ts   # temp dir, NOT committed
supabase secrets set API_FOOTBALL_KEY=... PROBE_TOKEN=...       # temporary names, unset afterwards
supabase functions deploy egress-probe-tmp --no-verify-jwt
curl -s -H "x-probe-token: $PROBE_TOKEN" "https://<project>.supabase.co/functions/v1/egress-probe-tmp?path=/leagues%3Fid%3D<ID>%26season%3D2026"    # call 1
curl -s -H "x-probe-token: $PROBE_TOKEN" "https://<project>.supabase.co/functions/v1/egress-probe-tmp"                                              # call 2
supabase functions delete egress-probe-tmp && supabase secrets unset API_FOOTBALL_KEY PROBE_TOKEN && rm -r supabase/functions/egress-probe-tmp
```
**Caution:** pushing `supabase/functions/**` to `main` auto-deploys; do this from the local CLI only and never commit the temp dir. The probe has no DB access and no service-role use, but Supabase injects its own env into every function; it does not read it.

## 4. Decision rule (item 9)
A. Supabase direct if its egress returns provider JSON cleanly and the scheduling/runtime limits suffice (pg_cron sub-minute, 150 s wall Free); B. Cloudflare thin producer if Cloudflare egress succeeds and measured CPU is comfortably inside the Free budget; C. Cloudflare Paid only if the Free CPU budget is **measured** insufficient. Note the project's separation principle (provider key in the Supabase runtime that also holds the service role) when A and B both pass.

## 5. What this phase never does
No activation of `live-producer-direct`, no `PRODUCER_MODE`, no `live_sports_cache` write, no change to the GitHub schedule or the Cloudflare→GitHub dispatch, no merge, no purchase.
