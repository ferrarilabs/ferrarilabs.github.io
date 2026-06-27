# v3.3.4 Stable Repair

This patch rolls back to the last stable DB/UI base and applies only the requested corrections.

## Fixed
- Language dropdown removed from the visible UI; only flag buttons remain.
- Timer now shows seconds and updates every second.
- Score input labels no longer show generic A/B; they show the resolved team names.
- Rules translation keys are repaired using `i18n-repair.js`.
- Supabase multi-tab mitigation added on focus/visibility change.
- Admin clear data clears local and remote state.
- Demo entries use `demo@noreply.invalid`.
- API-Football refresh has a 10-second timeout.

## Not changed
- Scoring logic.
- Email payload.
- Receipt logic.
- Database schema.
