# Where can the producer run? (Phase 2)

## Key question: can the existing Cloudflare Worker produce directly?

**Not today, by measurement: the Worker cannot reach ESPN** (403 from Akamai, measured by the project on 2026-08-28; see trace).
Code-wise it *could*: `normalize.js`/`gateway_core.js` are pure ESM and Workers run them. Two things block it: (1) egress (external, unfixable from
this repo — and bypassing a bot-protection block is not something to engineer around), (2) credential: direct production would need a DB write
key inside the Worker, which ADR-021 deliberately avoids.

What this branch does instead is make the Worker's *future* option free: the producer logic is now a portable core and a token-gated
ingest endpoint, so **whichever host can reach ESPN** — a public relay runner, a self-hosted runner, or (if Akamai ever relents) the Worker itself —
only has to do the GET and hand over the raw body. The Worker would then hold only the ingest token, never the service-role key.

```
today      CF Cron → GH dispatch → [private runner: GET ESPN + validate + normalize + write w/ service role] → live_sports_cache
proposed   CF Cron → GH dispatch → [PUBLIC relay runner: GET ESPN → POST raw] → Edge fn live-cache-ingest [validate+normalize+write] → live_sports_cache
future?    CF Cron → [Worker: GET ESPN → POST raw] → live-cache-ingest → live_sports_cache        (only if the Worker is ever allowed through)
```

## Candidates

| Option | Reaches ESPN | Secrets | Runtime limits | Cost | Verdict |
|---|---|---|---|---|---|
| Cloudflare Worker direct | **No (403 measured)** | needs write key (against ADR-021) | cron wall 15 min, 50 subrequests on Free plan | $0 | blocked on egress |
| Supabase Edge Function + pg_cron | **No (403 measured)** | has service role already | 150 s wall | $0 | blocked on egress |
| GitHub runner, private repo (today) | Yes | service role in Actions secrets | fine | **~11–17 k min/month** | not viable (account allowance 2,000; Pro 3,000, shared across repos) |
| **GitHub runner in a minimal PUBLIC repo (relay)** | **Yes (same runner pool)** | only `LIVE_INGEST_TOKEN` | same as today | **$0** (standard runners free for public repos) | **recommended** — ToS caveat below |
| Self-hosted runner on the private repo | Unverified (depends on host IP) | same as today | n/a | $0 minutes; needs an always-on host | fallback; reliability = the host |
| Other free VM (Oracle/Fly/etc.) | Unverified — datacenter IPs are what Akamai blocks | token | n/a | ~$0 | would need an egress probe first |
| Another data provider (API-Football etc.) | n/a | API key | n/a | free tiers limited | changes the data contract/scoring-adjacent logic; out of scope |

Evaluation axes for the recommendation: reuses what exists (Worker clock, gateway, table, normalize module — all unchanged);
idempotent (same upsert key `competition`, last-write-wins, fresh `observedAt`); retries (the 15 s loop is the retry; a failed pass never writes);
observability (Worker log + function log `{component,status,action}` + existing monitor); concurrency (relay `cancel-in-progress`, as today);
provider rate limit (same 2 requests per 15 s as today; relay stops after one pass when nothing is active); lock-in (none: ingest contract is a plain HTTP POST).

## Caveats, stated plainly

- **Actions ToS.** GitHub's terms restrict using Actions for purposes unrelated to the repository's software (serverless-style compute, etc.).
  A relay that feeds a production site is arguably in that gray zone. *This already applies to the current public-repo setup*; moving the
  work into a smaller, separate public repo does not make it worse, but it is a policy risk Eduardo should consciously accept or avoid
  (self-hosted runner removes it). I did not verify the current ToS wording this session.
- **New attack surface.** `live-cache-ingest` is an internet endpoint that can write the public sports cache for anyone holding the token.
  Mitigations implemented: token in constant-time compare, whitelist of 2 competitions, shape validation before any write, body cap, fail-closed 503
  without secret, writes only `live_sports_cache`, token never echoed. Residual: a leaked token can publish a *well-formed fake* score until rotated.
  The relay repo has no `pull_request` trigger, so fork PRs never see the secret.
- **Behavior difference to review.** The relay path decides "active" from the fresh scoreboard (live or kickoff within [-3 h, +1 h]) instead of the
  committed calendar; and, unlike today, it writes one observation per dispatch even outside the window (cache stays truthfully fresh around the clock
  instead of expiring to SOURCE_UNAVAILABLE). Judge during shadow comparison; if the old behavior is preferred, add an `?only_if_active=1` to the ingest.
