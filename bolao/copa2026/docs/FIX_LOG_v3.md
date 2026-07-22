# v3.0 Clean Rebuild

This is not a patch on the unstable v2.2. It is a clean rebuild using the existing data/assets.

## Fixed from Claude report
- CSV newlines
- Admin plaintext password comment removed
- No alternate fallback admin hash
- EmailJS throttle init
- Email payload reduced to html_message only
- Score/email validation in actual save flow
- Score 0-20 integer validation
- Winner/advance consistency validation
- Admin logout
- Admin delete entry
- Admin payment/result event delegation
- scoreEntry computed once per ranking row
- participants use single state read
- receipt opens via Blob URL, not document.write
- simulator blocked after cutoff and warns before overwriting
- dynamic team names escaped
- i18n for major alerts/status/phase labels
- public IP disabled by default

## Static site limitations
- Admin security is not real auth. Use Firebase/Supabase for production.
- Cutoff is client-side. Use backend/server timestamp for production.
- EmailJS public key is necessarily visible in browser-only apps.
