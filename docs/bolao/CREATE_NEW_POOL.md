# Create a New Pool — Full Checklist

Companion to `NEW_POOL_QUICKSTART.md` (the one-page command list). This is the detail behind
each step.

1. **Scaffold**: `node bolao/shared/scripts/new_bolao.mjs <app-id> --competition-id=<slug>`.
   Generates `bolao/<app-id>/scripts/sync_espn.py` (wired to the shared `espn_provider.py`,
   never a copy of its fetch/validate/normalize logic) and `QUICKSTART.md`.
2. **Confirm the ESPN slug is real**: run the generated `sync_espn.py` once; if it 403s or
   returns an unexpected shape, check `bolao/shared/scripts/espn_provider.py`'s
   `validate_scoreboard_shape()`/`validate_standings_shape()` output for the actual problem.
3. **Team-name aliases**: watch the first few real syncs for any team the app's own curated
   list doesn't recognize — add to this app's `sync_espn.py`'s `ALIASES` dict. Two real
   production incidents (documented in
   `docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md`) came from skipping this.
4. **Visual layer**: copy Copa2026's `index.html`/CSS references exactly (golden-master rule).
   Adapt `js/config.js`/`js/i18n.js`/`js/data.js`/`js/app.js` from the closest tournament-format
   match (see the quickstart for the three format buckets).
5. **Tournament logic**: scoring formula, bracket/table structure, tiebreak cascade — bespoke,
   requires Eduardo's explicit sign-off before real money is collected.
6. **`audit_scoring.py`**: write this app's own, following the pattern in any existing app's
   version. Must pass before the first real entry is accepted.
7. **Cache-busting**: add the app id to `APPS` in `bolao/scripts/cachebust.mjs`, run
   `node bolao/scripts/cachebust.mjs write --app=<app-id>`.
8. **Freshness guard**: `<meta name="build-id">` + `<script src="../shared/js/freshness-guard.js">`
   as the first script in `<head>`; wire `FreshnessGuard.state.fresh === false` into
   `guardAdmin()`.
9. **Notification outbox** (only if this app emails results): wire
   `bolao/shared/scripts/notification_outbox.py` into the send script's per-recipient loop —
   copy `bolao/cdb2026/scripts/send_result_email.py`'s `_send_to_all()` pattern. Read
   `docs/bolao/FOOTBALL_HARDENING_DURABILITY_AUDIT.md` first — the outbox is NOT durable across
   CI runs until `durable_persist.py` is wired into the real workflow (a separate, deliberate
   step, not automatic).
10. **Admin password hash / EmailJS keys / Supabase table+RLS**: see CLAUDE.md's "Bolão app —
    quick reference" for the exact mechanism.
11. **Governance**: register in `docs/bolao/PLATFORM_GOVERNANCE.md` and
    `docs/bolao/CONSISTENCY_MATRIX.md`.
12. **QA**: run `docs/bolao/QA_CHECKLIST.md` and/or `QA_MASTER_CHECKLIST.md` before the app is
    linked from anywhere real users will find it.
