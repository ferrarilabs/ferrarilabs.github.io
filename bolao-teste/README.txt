# Bolão do Ferrari — v2.0 Stabilization

## Fixes
- Email validation before saving.
- Admin logout.
- Admin delete entry.
- Delete entry attempts participant notification email.
- Removed broken PDF download flow; now opens receipt for browser save/print.
- Score validation for impossible winner/advance combinations.
- Alerts unusual scores and repetitive score patterns.
- CashApp fixed to `$EduardoFerrari`.
- Podium highlight remains in receipt/email.
- QA checklist and deploy docs included.

## Deploy
Use `docs/DEPLOY.md`.

## Important
This is still static GitHub Pages + localStorage. Good for friend testing. For production use, migrate to Firebase/Supabase.


## v2.1 Audit Fixes

See `docs/FIX_LOG_v2_1.md` and `docs/QA_CHECKLIST_v2_1.md`.
