# v3.3.2 DB Blockers + Timer

Surgical patch over v3.3.1.

## Fixed
- Countdown now includes seconds and updates every second.
- Supabase multi-tab mitigation:
  - reloads remote state on tab focus;
  - reloads remote state on visibility change.
- Admin clear data now clears local and remote state.
- Async init errors are caught and logged.
- Spanish `phaseThird` fixed.
- Demo data now uses `demo@noreply.invalid`.
- API-Football refresh now has a 10-second timeout.
- Supabase SQL docs now include a JSON payload size constraint.

## Not changed
- Scoring.
- Email templates.
- Receipt formatting.
- Supabase table design.
- API-Football does not overwrite bracket data.
