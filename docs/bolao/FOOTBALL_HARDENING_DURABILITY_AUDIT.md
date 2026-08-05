# Football Hardening — Outbox Durability Audit (post-checkpoint-H follow-up)

## Finding: FAIL — NÃO DURÁVEL (as originally built in checkpoints D/F)

Investigated the real production topology, not assumed:

- `grep -rl "sync_espn\|reconciler.mjs\|notification_outbox\|pipeline_health" .github/workflows/`
  → **NONE FOUND**. No workflow ever calls the checkpoint C/D pipeline.
- `notification_outbox.json` / `match_store.json` → **NOT TRACKED IN GIT**.
- Every relevant workflow (`cdb2026_result_emails.yml`, `auto_results.yml`,
  `br2026_round_emails.yml`) does `actions/checkout@v4` (fresh clone) with **no
  `actions/cache` or `actions/upload-artifact`/`download-artifact` anywhere in this repo's
  workflows**.

**Consequence**: the checkpoint D/F outbox is a local JSON file on the ephemeral GitHub Actions
runner filesystem. It survives zero seconds past the end of a workflow run. The checkpoint F
commit's claim that this wiring "prevents duplicate sends" was only true within a single
process's lifetime — in the real cross-run topology, `find_by_idempotency_key()` always returns
`null` on a fresh checkout because the file never existed there.

**Important nuance, verified for honesty**: production is not currently sending duplicate
emails. `send_result_email.py`'s pre-existing (pre-this-branch) Supabase-backed checks
(`sb_lock_tie()` refusing to relock an already-decided tie, `_find_new_legs()` diffing against
legs already saved in Supabase) are the actual, real, independent duplicate-prevention mechanism
today, and remain untouched and correct. But the checkpoint D/F pipeline itself was not
load-bearing in production and did not deliver the cross-run guarantee earlier reports implied.

## Fix built and tested: git as the durable store

New `bolao/shared/scripts/durable_persist.py`:

- **Physical file path**: `bolao/shared/scripts/notification_outbox.json` /
  `bolao/shared/scripts/match_store.json` (unchanged paths — same files the JS/Python outbox
  modules already read/write).
- **Who creates it**: the first `enqueue()` call from any runner, any language.
- **Who reads it**: any subsequent runner's `read_all()` / `find_by_idempotency_key()` call,
  after a fresh `git clone`/`checkout` — the file is part of the repo's tracked tree from that
  point on.
- **Who updates it**: `enqueue()` / `record_result()` (unchanged) followed by a NEW
  `durable_persist.sync_state()` call that commits and pushes the change.
- **Who persists it**: git itself — the commit lands on `origin/main` (or a dedicated branch,
  configurable), so the NEXT workflow's `actions/checkout@v4` gets it for free, with zero new
  infrastructure (no database, no cache action, consistent with this repo's existing "CI commits
  a generated file back" pattern already used for cache-bust version bumps).
- **When it's removed**: never automatically — job records accumulate; a future retention/GC
  step is a documented follow-up, not built in this pass (see "Not done" below).
- **How a different runner recovers it**: `git clone`/`checkout` at the start of its own run —
  proven for real, not assumed, by `test_durable_persist.py`'s three genuinely separate
  `git clone`s of a bare repo (no shared temp dir, no shared process memory).
- **How concurrent conflicts are handled**: commit locally first (working tree must be clean for
  `git pull --rebase` to succeed — an earlier version of this fix got this ordering backwards and
  failed 100% of the time, caught by the test itself, not shipped). Push; on rejection, rebase
  onto the new tip and retry. **A real conflict was found and fixed during this work**: two
  runners concurrently appending different array elements to the same pretty-printed JSON file
  produces a genuine git rebase conflict (both diffs touch the same `[]`-adjacent line) — git's
  line-based merge cannot resolve this correctly. Fixed with `merge_job_arrays()`, a JSON-aware
  union merge keyed by `jobId`/`matchId`, reusing this repo's own already-documented "union
  entries, local wins for the more-progressed status" strategy (CLAUDE.md's Supabase merge
  policy) instead of inventing a new one.

## Real test: three independent clones, no shared workspace

`bolao/shared/scripts/test_durable_persist.py` — 2 tests, both passing, run 4 times total during
this work (1 failure caught and fixed each of two separate times: the pull-before-commit
ordering bug, then the line-based-merge-conflict bug):

```
test_three_independent_runners_no_lost_no_duplicate_no_altered_snapshot ... ok
test_concurrent_push_conflict_neither_runner_loses_its_job ... ok

Ran 2 tests in 2.2-2.4s
OK
```

Runner A (fresh clone) creates 2 jobs, pushes, terminates. Runner B (fresh clone, zero relation
to A's directory) recovers both jobs from git alone, processes them, pushes. Runner C (fresh
clone again) sees exactly 2 jobs (not 0, not 4), both `sent`, re-enqueuing the same idempotency
key creates nothing new, and every `payloadSnapshot` is byte-identical to what Runner A wrote.
The concurrency test additionally proves two runners racing to push different jobs at the same
tip both survive (neither is lost), via the retry+JSON-merge path specifically (`attempts > 1`
asserted, not just an eventual pass).

**Mandatory pass criteria, literal**: lost jobs = 0, duplicated jobs = 0, altered snapshots = 0,
dependency on a previous runner's workspace = 0 (distinct temp-dir clones, only channel is the
bare git remote).

## What this fix does NOT do yet (explicit, not swept under the rug)

- **Not wired into the real production workflow YAML** (`cdb2026_result_emails.yml`,
  `auto_results.yml`, `br2026_round_emails.yml`) in this pass. Adding a git-push step to a live,
  money-critical, 10-minute-cron email workflow deserves its own dedicated review and staged
  rollout, not a same-session bolt-on to an already-large branch. This is the single most
  important open item before the checkpoint D/F pipeline can be considered production-ready.
- **No retention/GC** for old "sent" job records — the outbox file grows forever as currently
  designed. Not a correctness bug, but worth a follow-up before long-term use.
- **Requires the workflow's `GITHUB_TOKEN` (or a PAT) to have push access** and the workflow's
  `concurrency:` group to remain serialized (already true today for `cdb2026_result_emails.yml`:
  `cancel-in-progress: false`) — parallel/non-serialized runners would exercise the conflict path
  far more often; it is tested and works, but more contention is still more risk than less.

## Recommendation

This durable-persistence gap is a genuine, previously-unverified blocker. The fix is now real,
tested, and reviewable — but **not yet wired into production**. Treat "wire durable_persist.py
into the three real workflows, with its own dedicated staged rollout" as a required follow-up
before the checkpoint D/F pipeline is relied upon for real cross-run duplicate prevention.
