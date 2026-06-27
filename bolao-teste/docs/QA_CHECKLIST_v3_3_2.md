# QA Checklist v3.3.2

## Timer
- [ ] Timer shows days, hours, minutes, seconds.
- [ ] Seconds update every second.

## Supabase
- [ ] Create entry in Browser A, switch/focus Browser B, refresh/visibility reload shows update.
- [ ] Admin clear data removes data after refresh.
- [ ] Supabase `bolao_state` row becomes empty after clear data.
- [ ] Site still works if Supabase fails.

## Other fixes
- [ ] ES third-place phase label is Spanish.
- [ ] Demo entries use demo@noreply.invalid.
- [ ] API-Football refresh times out instead of hanging.
