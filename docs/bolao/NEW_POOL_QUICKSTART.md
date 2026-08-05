# New Pool Quickstart

One page. Copy-paste these commands.

```bash
# 1. Scaffold the operational plumbing (ESPN sync wired to the shared provider)
node bolao/shared/scripts/new_bolao.mjs <app-id> --competition-id=<espn-slug> [--kind=scoreboard|standings]

# 2. Read the generated file — it lists every manual step below in detail
cat bolao/<app-id>/QUICKSTART.md

# 3. Copy the visual layer from the canonical reference (Copa2026 — see
#    docs/bolao/DESIGN_SYSTEM.md). Adapt js/config.js, js/i18n.js, js/data.js, js/app.js from
#    whichever existing app is the closest tournament-format match:
#      - bracket/knockout single-match      -> bolao/copa2026/
#      - two-leg-tie knockout               -> bolao/cdb2026/
#      - league table / standings           -> bolao/br2026/
cp bolao/copa2026/index.html bolao/<app-id>/index.html   # then edit paths/CSP/meta

# 4. Write THIS app's own scoring formula + audit_scoring.py (never skip — see
#    docs/bolao/ENGINEERING_STANDARD.md, money-critical). Get Eduardo's explicit sign-off
#    before it goes live.

# 5. Register cache-busting
#    (edit APPS array in bolao/scripts/cachebust.mjs to add "<app-id>")
node bolao/scripts/cachebust.mjs write --app=<app-id>

# 6. Wire the freshness guard — add to index.html <head>, first script tag:
#    <meta name="build-id" content="<from step 5's build-version.json>">
#    <script src="../shared/js/freshness-guard.js"></script>
#    Then in js/app.js's guardAdmin(): block on window.FreshnessGuard.state.fresh === false
#    (copy the exact pattern from bolao/cdb2026/js/app.js's guardAdmin()).

# 7. (Only if this app sends result emails) wire the shared outbox — copy the
#    _send_to_all()/idempotency-key pattern from bolao/cdb2026/scripts/send_result_email.py.

# 8. Verify everything
python3 bolao/<app-id>/scripts/audit_scoring.py
node bolao/scripts/cachebust.mjs check --app=<app-id>
node bolao/scripts/test_zero_stale_cache.mjs
python3 -m http.server 8080   # then open http://localhost:8080/bolao/<app-id>/

# 9. Register in platform docs (mandatory, not optional)
#    - docs/bolao/PLATFORM_GOVERNANCE.md — add the app to the governed-apps list
#    - docs/bolao/CONSISTENCY_MATRIX.md — add a row for every shared component this app uses
```

See `docs/bolao/AGENT_IMPLEMENTATION_CONTRACT.md` for the minimal prompt to hand an agent to do
this end-to-end. See `docs/bolao/CREATE_NEW_POOL.md` / `ADD_PROVIDER.md` / `ADD_NOTIFICATION.md`
/ `REVIEW_POOL.md` for narrower, single-purpose playbooks.
