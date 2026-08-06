# Powerball Result Email — 2026-08-05 Incident Report

## Symptom

The 2026-08-05 draw (a real Powerball drawing, real result: 14-20-59-60-61,
Powerball 25, Power Play 2x — cross-confirmed via NY Open Data's official
Socrata endpoint and independent news search) completed at 22:59 ET, but no
result email was sent to real participants and the public site's result
section was not refreshed by any automated process afterward.

## Diagnosis

- **Which workflow should have fetched the result and sent the email**:
  `.github/workflows/powerball-results-email.yml` ("Powerball Results (auto
  fetch + email)"), which runs `scripts/fetch_and_send_results.py` on a
  cron schedule.
- **Did it run?** No. `gh run list` shows zero executions of this workflow
  around the 2026-08-05/06 window (or at all, in the visible run history).
- **Root cause**: the cron schedule only covered **Tuesday** and
  **Saturday** draw-night windows (`cron: '*/10 22-23 * * 2'` /
  `'*/10 0-6 * * 3'` for Tuesday, `'*/10 22-23 * * 6'` / `'*/10 0-6 * * 0'`
  for Saturday). Real Powerball draws happen **Monday, Wednesday, and
  Saturday** — the schedule had **no Monday and no Wednesday entries at
  all**. 2026-08-05 was a Wednesday, so the workflow's trigger window never
  existed for that draw night; it silently never fired. This is a
  configuration bug, not a runtime failure — there is no error to find in
  logs because the workflow never started.
- **Was the result ever detected as final by the app itself?** Yes,
  separately — a prior session/commit (`a1ca78b`) manually added the
  official result to `js/data.js` after confirming it via a powerball.com
  screenshot (NY Open Data hadn't published yet at that time), and a
  follow-up commit (`63f6c0c`) fixed three unrelated bugs in
  `send_result_email.py` (a stale placeholder draw entry, a regex that
  could never match real participants, and a dead Supabase email lookup)
  and confirmed a `--test-send` (admin-only preview) succeeded. **No
  `--send-all` (real broadcast) was ever executed** by that legacy script —
  confirmed by the absence of any fresh log in `logs/` beyond
  `send_result_email_20260804_172718.log` (pre-dates the draw) and no
  corresponding GitHub Actions run.
- **Permission/commit/push/cache errors?** None found — the workflow has
  `permissions: contents: write` and a normal checkout/setup-python/send
  sequence; it simply never triggered.
- **Silent failure?** Yes, in the sense that a missing cron entry produces
  no error signal anywhere — the workflow appears "healthy" (`gh workflow
  list` shows it as `active`) while never actually running on the days that
  matter.

## Fix implemented (2026-08-06)

`.github/workflows/powerball-results-email.yml` cron schedule extended to
cover all three real draw nights: Monday, Wednesday, and Saturday (each with
its own two-window pair — the draw-night UTC hours plus the following-day
early-UTC-morning window that covers the same ET evening), matching the
existing Saturday/Sunday pattern exactly. See the commit for the literal
diff and inline comments explaining each cron line.

## Separate remediation performed manually today (2026-08-06)

Because the automated path had already missed the window, the real result
email was sent manually today using the new professional email format
(`scripts/email/send_draw_result.mjs`), not the legacy
`send_result_email.py` — see
`docs/bolao/loterias/POWERBALL_EMAIL_OPERATIONS_RUNBOOK.md` for the full
send record (eligible/excluded counts, reconciliation, per-send evidence).
This was a one-time manual remediation; going forward, the fixed cron
schedule (once combined with pointing the workflow at the new professional
format — see "Next steps" below) should make future draws send
automatically again.

## Next steps (not done in this pass)

- `fetch_and_send_results.py` (the script the fixed workflow actually
  calls) still uses the **legacy** email format
  (`scripts/send_result_email.py`'s template), not the new professional
  format used for today's manual send. Migrating the automated workflow to
  call the new `scripts/email/send_draw_result.mjs` pipeline instead is a
  separate follow-up, not performed today (today's fix was scoped to the
  cron schedule bug specifically, plus the one-time manual send).
- No jackpot-hit path has been tested end-to-end in the new professional
  format (today's draw had no jackpot winner) — worth a dry-run exercise
  before it's needed for real.
