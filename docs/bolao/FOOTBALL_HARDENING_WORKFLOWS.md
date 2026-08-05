# Reusable Workflows — Safe Mode (item 8)

Five new workflows, all `.github/workflows/bolao_*.yml`, all **`workflow_dispatch` only — no
`schedule:` trigger, verified by parsing every file with PyYAML and asserting `schedule` is
absent** (see commit history for the raw check). No new production schedule is activated by this
branch.

| Workflow | Trigger | Intended (future) schedule | Script | Backend | Secrets | Concurrency | Timeout | Failure recovery |
|---|---|---|---|---|---|---|---|---|
| `bolao_provider_snapshot.yml` | `workflow_dispatch` (app, dry_run) | every 10-15 min during live windows | `sync_espn.py` | local JSON file only | none | per-app group, queued | 10 min | stale-preservation in `espn_provider.py` |
| `bolao_result_processing.yml` | `workflow_dispatch` (app, dry_run) | N/A — safe-mode test harness for the EXISTING production crons, not a replacement | `send_result_email.py` / `send_round_email.py --auto` | Supabase (production project) | none (public anon keys hardcoded, existing pattern) | per-app group, queued | 20 min | scripts' own read-modify-write, no partial-write state |
| `bolao_notification_worker.yml` | `workflow_dispatch` (dry_run) | every 5-10 min once wired to real recipients | `notification_worker.mjs` | local files today, Supabase once wired | none | single global group | 10 min | dry-run untouched; real mode's atomic writes |
| `bolao_reconciliation.yml` | `workflow_dispatch` (dry_run) | every 15-30 min (wider than the worker) | `notification_worker.mjs` (same script, different cadence) | same as worker | none | single global group | 15 min | same as worker |
| `bolao_health_check.yml` | `workflow_dispatch` | on-demand / every few hours | `pipeline_health.mjs --json` | read-only | none | none (safe to overlap) | 5 min | N/A, read-only |

## Local-equivalent execution (proving the scripts work, since real triggering risks a real send)

Per-workflow, the exact command each job step runs, already executed for real in this session
(see the commits for `61ecde9` and this checkpoint's regression log):

```bash
# bolao_provider_snapshot.yml's step, for real:
python3 bolao/cdb2026/scripts/sync_espn.py   # (also run for br2026, copa2026)

# bolao_result_processing.yml's step, dry-run:
python3 bolao/cdb2026/scripts/send_result_email.py --auto --dry-run
python3 bolao/copa2026/scripts/send_result_email.py --auto --dry-run
python3 bolao/br2026/scripts/send_round_email.py --auto --dry-run

# bolao_notification_worker.yml / bolao_reconciliation.yml's step, dry-run:
node bolao/shared/scripts/notification_worker.mjs --dry-run

# bolao_health_check.yml's step:
node bolao/shared/scripts/pipeline_health.mjs --json
```

All five ran successfully in this session with the results described in the commits above — this
IS the "run workflow_dispatch (or local equivalent) in fixture/dry-run mode" proof; the actual
`gh workflow run` was not triggered against GitHub's real infrastructure (would require pushing
these files to the default branch or a workflow_dispatch-eligible ref, and offers no additional
proof beyond what running the exact same commands locally already demonstrates).

## Environments

Each production-capable job sets `environment: test` when `dry_run == true` and `environment:
production` otherwise — GitHub Environments can be configured with their own required-reviewer
gates and secrets scoping (not configured in this pass; the environment names are declared so
that gate can be added later without a workflow-file change).
