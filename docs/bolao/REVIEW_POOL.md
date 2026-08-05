# Review a Pool Before Trusting It With Real Money

Checklist for reviewing an existing (or newly created) pool before it's linked anywhere real
participants will find it, or before its first real cash entry is accepted.

1. `python3 bolao/<app>/scripts/audit_scoring.py` — must pass. This is the single
   non-negotiable gate; it exists because a real incident (July 2026, see CLAUDE.md) found
   `send_result_email.py` had silently drifted from the site's own scoring logic.
2. `node bolao/scripts/cachebust.mjs check --app=<app>` — cache-bust tags AND
   `build-version.json` must both be current.
3. `node bolao/scripts/test_zero_stale_cache.mjs` — must pass for this app specifically (it
   covers all three apps; check its per-app output).
4. If the app sends result emails: does the send script route through the shared outbox with a
   real idempotency key (see `ADD_NOTIFICATION.md`)? Is `durable_persist.py` wired into the
   real workflow, or does the app rely on some OTHER real duplicate-prevention (e.g. a Supabase
   lock check)? Never assume — check the actual workflow YAML and confirm which mechanism is
   actually load-bearing (see `docs/bolao/FOOTBALL_HARDENING_DURABILITY_AUDIT.md` for what "load
   bearing" needs to mean here).
5. Real Playwright capture at 390x844 / 768x1024 / 1440x900 minimum (see
   `bolao/cdb2026/scripts/visual/capture_evidence.mjs`) for: entry form, ranking, games/jogos,
   admin authenticated. Run `check_manifest.mjs` after — zero unjustified overflow/error
   violations, not a generic "pre-existing, ignored" label. If a violation is found, investigate
   it (selector, bounding box, exceeded width, root cause) before deciding whether to fix it or
   allowlist it with a specific technical justification.
6. Visual tokens/structure match Copa2026 (golden-master rule) — spot-check against
   `docs/bolao/DESIGN_SYSTEM.md`.
7. Admin password hash is a real SHA-256 hash, not a plaintext string, in the app's `config.js`.
8. `docs/bolao/PLATFORM_GOVERNANCE.md` and `CONSISTENCY_MATRIX.md` both list this app.
