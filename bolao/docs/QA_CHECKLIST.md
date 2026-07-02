# QA Checklist — v4.0-clean

Run these checks after every deploy.

## Registration flow
- [ ] 1. Fill all bracket matches (73–104) with valid scores and advance sides.
- [ ] 2. Submit with valid name, payer, email, payment method. Entry is saved.
- [ ] 3. Receipt box appears with a `BOLAO-XXXXXXXX-YYYYMMDD` code.
- [ ] 4. "Open receipt" opens a new tab with self-contained HTML.
- [ ] 5. "Download HTML" downloads the receipt file (no `document.write` used).
- [ ] 6. "Send email" sends confirmation to the participant email.
- [ ] 7. Draft is cleared from sessionStorage after successful save.

## Validation
- [ ] 8. Submitting with a missing match score shows an alert naming the match.
- [ ] 9. Submitting with a tied score but no advance side selected is blocked.
- [ ] 10. Score >20 is silently clamped or rejected.
- [ ] 11. Unusual score (e.g., 10×0) triggers a confirmation dialog.
- [ ] 12. Invalid email format is rejected before save.

## Draft restore
- [ ] 13. Fill some scores, refresh the page → offered to restore draft → accepts → scores restored.
- [ ] 14. Draft older than 2 hours is silently discarded.

## Admin panel
- [ ] 15. Wrong password triggers attempt counter; after N attempts, admin is locked for 15 min.
- [ ] 16. Admin session expires after 30 min of inactivity (check console or try an action after timeout).
- [ ] 17. Mark payment as paid → persists after reload.
- [ ] 18. Enter a real result for match 73 → ranking updates points.
- [ ] 19. Delete an entry → entry disappears from ranking and participants list.
- [ ] 20. "Download CSV" produces a valid CSV with headers; opens correctly in Excel (CRLF line endings).

## Language
- [ ] Switching PT-BR / ES / EN updates all visible strings including phase labels and rules.

## Cutoff
- [ ] After cutoff date: save button is disabled; bracket inputs are disabled.

## Supabase (if enabled)
- [ ] Entry created in browser A appears in browser B after refresh.
- [ ] Offline mode (disconnect): entry is saved locally; after reconnect, syncs to Supabase.
