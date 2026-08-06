# Staged Rollout Plan

Ordered, each stage gated on the previous one's real evidence — no stage starts on an assumption
carried over from the previous one.

## Stage 0 — where we are now

Code-complete: `NotificationRepository` contract, `Memory`/`File`/`Supabase` adapters, SQL
proposal, canonical schema, real `--dry-run`, 5 safe-mode workflows. Verdict: **NOT READY —
AGUARDANDO SUPABASE DE TESTE** (section 6 unproven).

## Stage 1 — real Supabase test execution (blocking, do this first)

- Follow `docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_COMMANDS.md` against a genuinely separate
  test project.
- Pass criteria: zero double-claims, zero duplicate sends, zero lost jobs, zero altered
  snapshots — literal zero, not "close to zero."
- Exit: `FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md` updated with real output. Verdict can
  move to "READY FOR STAGED TEST DEPLOYMENT" only after this.

## Stage 2 — apply schema to production-adjacent test data, one app only

- Pick the LOWEST-risk app first (BR2026 — not yet linked from the main site, per CLAUDE.md).
- Apply `001_bolao_notification_schema.sql`/`002_...rpc.sql` to the REAL production Supabase
  project (schema-only — new tables, zero impact on existing `bolao_state`).
- Wire `bolao_notification_worker.yml` with `dry_run: true` on a manual trigger only (still no
  schedule) against real BR2026 data, inspect output for a real (but harmless, dry-run) cycle.

## Stage 3 — BR2026 real writes, manual trigger only

- Flip `dry_run: false` for BR2026 only, still manual `workflow_dispatch`, watched live.
- Confirm real rows land in `bolao_notification_jobs`/`bolao_notification_deliveries`, confirm
  `bolao_processing_runs` shows the run.
- No real recipient email yet — the send function stays a fake/log-only provider one more stage.

## Stage 4 — BR2026 real sends, manual trigger, low volume

- Swap the fake provider for the real EmailJS call, still manual trigger, ideally against a
  batch with few recipients first.
- Confirm zero duplicates on a deliberate re-run of the same trigger (proves the idempotency key
  + Supabase claim actually work in production, not just in Stage 1's test project).

## Stage 5 — BR2026 scheduled, tight interval, monitored

- Enable a real `schedule:` trigger on `bolao_notification_worker.yml` for BR2026 only, at a
  conservative interval (e.g. every 15 min) — a deliberate, separate PR/commit from this branch,
  reviewed on its own.
- Watch `bolao_processing_runs` and `pipeline_health.mjs` for at least one full live match window
  before trusting it unattended.

## Stage 6 — extend to CDB2026 and Copa2026

- Same Stage 2-5 sequence, per app, NOT all at once — CDB2026 is already in production with real
  money; Copa2026 is archived (lower urgency, can go last or be skipped if the tournament staying
  concluded means this pipeline is moot for it).
- Only after BR2026 has run unattended, on schedule, for at least one real match window with zero
  incidents.

## Stage 7 — retire the old file-backed outbox wiring in the three send scripts

- Once all three apps are on `SupabaseNotificationRepository` via the reusable workflows, the
  old `_send_to_all()`/`notification_outbox.py` direct-file wiring (checkpoint F) can be removed
  from each send script — a separate cleanup PR, not bundled with any functional change.

## Non-negotiables at every stage

- No stage skips its own real test evidence to save time.
- No stage silently widens scope (e.g. "while I'm in there, might as well enable CDB2026 too").
- Any incident at any stage halts progression to the next stage until root-caused (same
  audit-first workflow as `docs/bolao/ENGINEERING_STANDARD.md`).
