# v3.1 Fixes

Corrections based on the v3 audit.

## Fixed
- Final bonus scoring is now included in `scoreEntry()`:
  - Champion
  - Runner-up
  - 3rd place
  - 4th place
- Exact score comparisons now use numeric comparison for migration safety.
- Ranking row toggle uses event delegation instead of per-row listeners.
- Remaining email alerts moved to i18n.
- Auto-advance/tie notes moved to i18n.
- Email field label now indicates it is required.
- Admin session timeout is enforced on admin actions, not only page load.
- Admin result input auto-commits winner side for non-tied scores.
- Admin headings moved to i18n.
- Email auto-send errors are logged to console instead of silently swallowed.
