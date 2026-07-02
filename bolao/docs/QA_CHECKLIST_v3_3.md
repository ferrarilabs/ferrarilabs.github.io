# QA Checklist v3.3-db-ready

## Without Supabase configured
- [ ] Site loads normally.
- [ ] Save entry works.
- [ ] Ranking works.
- [ ] Admin works.
- [ ] Email still works.
- [ ] No visible user-facing database error.

## With Supabase configured
- [ ] Site loads with `database.enabled = true`.
- [ ] Entry created on phone appears on desktop after refresh.
- [ ] Admin paid flag appears across devices after refresh.
- [ ] Admin result appears across devices after refresh.
- [ ] Delete entry syncs across devices after refresh.
- [ ] If Supabase is temporarily unavailable, local save still works.
