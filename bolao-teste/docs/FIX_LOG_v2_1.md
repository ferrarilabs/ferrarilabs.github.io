# v2.1 Audit Fix Log

Corrections based on Claude audit and manual testing.

## Critical fixes
- Removed plaintext admin password comment from `config.js`.
- Removed alternate fallback admin hash from `app.js`.
- Fixed literal `\\n` joins so CSV/plain text use real line breaks.
- Added EmailJS init throttle.
- Reduced EmailJS payload to avoid template showing both HTML and raw text.

## Validation fixes
- Email is required and validated in the real save flow.
- Scores must be whole numbers from 0 to 20.
- `22x2`, `21x0`, decimals, negatives, blanks and letters are blocked.
- `10x0` and other very unusual scores trigger a warning.
- Repetitive/preguiçoso score patterns trigger a warning.
- Winner/advance mismatch is blocked in user picks and admin real results.

## Admin fixes
- Admin logout clears session and timeout.
- Admin session expires after 30 minutes.
- Admin payment/results use delegated events to avoid duplicate listeners.

## Receipt/email fixes
- Removed broken PDF generation path.
- Receipt open detects popup blocking.
- Plain text no longer uses HTML escaping.
- Email payload now expects template body to use only `{{{html_message}}}`.
