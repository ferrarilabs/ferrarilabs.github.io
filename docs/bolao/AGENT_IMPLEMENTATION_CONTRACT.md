# Agent Implementation Contract — Football Bolão Platform

Short, on purpose. This exists so a future request never again turns into a 12-section,
multi-day mega-prompt like the one this contract was written in response to. If a request would
require re-explaining more than what's below, STOP and ask for a scoped-down version first.

## The minimal prompt needed to create a new pool, going forward

```
Read docs/bolao/NEW_POOL_QUICKSTART.md and run it for <competition name>, ESPN slug
<slug>, format <bracket|two-leg-knockout|league-table>. Stop after step 4 (scoring formula)
and show me the formula before writing audit_scoring.py — everything else can proceed
without a checkpoint.
```

That's it. Everything else — provider wiring, cache-busting, freshness guard, notification
outbox, tests — is mechanical, covered by the quickstart, and doesn't need to be re-litigated
per pool.

## What every implementation MUST do (non-negotiable, from CLAUDE.md)

1. Report current branch, git status, latest commit, apps affected, change classification,
   cross-app propagation decision — BEFORE editing anything.
2. Reference the shared framework (`bolao/shared/scripts/espn_provider.py`,
   `notification_outbox.{py,mjs}`, `match_state_machine.mjs`, `reconciler.mjs`,
   `bolao/shared/js/freshness-guard.js`, `bolao/scripts/cachebust.mjs`,
   `bolao/shared/scripts/pipeline_health.mjs`) — **never duplicate their logic into a new
   per-app copy**. If the shared framework doesn't do what this pool needs, extend it in
   place (additively) and update its shared test suite, don't fork it.
3. Never touch scoring/business logic without Eduardo's explicit authorization.
4. Never mix refactor with bug fix in the same patch.
5. Run every app's `audit_scoring.py` after any change, even ones that look unrelated
   (see CLAUDE.md's "why" — this has caught two real production bugs).
6. Copy Copa2026's visual tokens/structure/CSS for any new UI — never invent new patterns
   (golden-master rule).
7. No real emails, no production Supabase writes, no merge, no deploy without explicit
   instruction to do so.

## What every implementation must NOT do

- Duplicate the ESPN provider, outbox, reconciler, freshness-guard, or pipeline-health logic
  into a new file instead of importing/reusing the shared one.
- Claim a durability/reliability guarantee that hasn't been proven with a real test (e.g. "the
  outbox is durable across CI runs" requires a real multi-runner test, not an assumption —
  see `docs/bolao/FOOTBALL_HARDENING_DURABILITY_AUDIT.md` for what happens when this rule is
  skipped).
- Use real `sleep`/wall-clock timing in a test. Use a fake clock or mock the throttle.
- Report a checkpoint "done" without the actual command output (exit code + relevant lines),
  not a paraphrase.

## Escalate instead of guessing when

- A change would affect scoring, ranking, or payouts.
- A change would touch a currently-in-production email cron (`*_result_emails.yml`,
  `*_round_emails.yml`) — these move real money-adjacent participant trust; wire new
  infrastructure into them as its own dedicated, reviewed step, not a same-session bolt-on.
- Two apps' requirements genuinely conflict (tournament-specific logic is allowed to differ;
  shared visual/infra components are not).

## Playbooks (single-purpose, each shorter than this file)

- `docs/bolao/CREATE_NEW_POOL.md` — the full checklist behind `NEW_POOL_QUICKSTART.md`.
- `docs/bolao/ADD_PROVIDER.md` — wiring a new data source into `espn_provider.py`'s pattern.
- `docs/bolao/ADD_NOTIFICATION.md` — wiring a new send script into the shared outbox.
- `docs/bolao/REVIEW_POOL.md` — the checklist for reviewing an existing pool before trusting it
  with real money.
