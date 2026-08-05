# Add a Data Provider

For a new pool that needs a data source other than (or in addition to) ESPN's public
scoreboard/standings endpoints, or a second competition within an existing app.

1. **Do not write a new fetch/validate/normalize implementation.** Extend
   `bolao/shared/scripts/espn_provider.py` if the new source is still ESPN-shaped (a different
   competition slug — that's just new config, see `CREATE_NEW_POOL.md` step 1). If it's a
   genuinely different API shape, add a new `validate_<source>_shape()` /
   `normalize_<source>()` pair alongside the existing ones in the SAME shared file, following
   the existing scoreboard/standings pattern (timeout+retry via `fetch_json()`, shape validation
   before trusting content, atomic write via `write_snapshot_atomic()`, stale-preservation on
   failure via `build_snapshot()`).
2. Add tests to `bolao/shared/scripts/test_espn_provider.py` for the new validate/normalize
   pair — synthetic fixtures only, same style as the existing scoreboard/standings tests.
3. Each app's own `sync_espn.py` (or `sync_<provider>.py`) stays a thin, declarative config file
   — `kind`, `source_url`, `aliases`, `output_path` — calling the shared `run_sync()`. If you
   find yourself writing fetch logic inside an app's own sync script, stop — that logic belongs
   in the shared provider.
4. Run `python3 bolao/shared/scripts/test_espn_provider.py` and the affected app's own sync
   script manually before wiring it into anything scheduled.
