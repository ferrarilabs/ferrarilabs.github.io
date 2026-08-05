# Add a Notification / Result-Email Flow

For wiring a new send script (or a new email type in an existing one) into the shared outbox.

1. **Read `docs/bolao/FOOTBALL_HARDENING_DURABILITY_AUDIT.md` first.** The outbox
   (`notification_outbox.py`/`.mjs`) provides duplicate-prevention only for the lifetime of a
   single process UNLESS `durable_persist.py` is explicitly wired in — do not assume
   cross-run durability without checking whether that wiring exists for the workflow you're
   touching.
2. Import the shared outbox — `bolao/shared/scripts/notification_outbox.py` (Python) or
   `.mjs` (Node) — never reimplement enqueue/claim/record logic per app.
3. Pattern to copy exactly: `bolao/cdb2026/scripts/send_result_email.py`'s `_send_to_all()`.
   Build an idempotency key via `outbox.idempotency_key(app, matchId_or_batchId, recipient,
   resultVersion)`, check `find_by_idempotency_key()` before sending, `enqueue()` before the
   real send attempt, `record_result()` after.
4. `matchId`/`resultVersion` must be STABLE across retries of the same logical event (same
   match, same result) and DIFFERENT for a genuine correction (bumped version) — see
   `bolao/cdb2026/js/match_store.mjs`'s version-bump-only-on-real-change logic for the pattern,
   or the simpler per-script convention already used (phase:tie:leg for CDB2026, `M{mid}` for
   Copa2026, sorted gameIds for BR2026's batches).
5. Write a test using the exact pattern in any of the three existing
   `test_notification_bridge.py` files: monkeypatch the real send function to a synthetic
   recorder, monkeypatch `time.sleep` to a no-op (never real-sleep in a test), assert on
   sent-count / duplicate-prevention / failure-recording, using an isolated temp-file outbox
   path (never the real repo's outbox file).
6. If this flow needs to survive across independent CI runs (most result-email crons do),
   see `durable_persist.py` and its test — wiring it into a live production workflow is its own
   deliberate, separately-reviewed step, not something to bundle into the same patch as the
   notification logic itself.
