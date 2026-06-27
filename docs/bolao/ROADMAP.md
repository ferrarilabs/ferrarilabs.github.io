# Roadmap — Bolão do Ferrari

This documents items that were discussed or requested but not yet built. Nothing here is committed — it is a parking lot for future sessions.

## Near-term (during Copa 2026, before July 19)

### N-01 — Update data.js with Round of 32 results
As matches 73–88 complete (June 28–July 3), `DATA.knockoutMatches` goalsA/goalsB/winner/status must be updated manually. Also update `updatedLabel`.

### N-02 — Update data.js third-place group qualifiers
Several R32 slots still say "3rd A/B/C/D/F" style. Once group stage ends (June 27–28), those slots resolve to actual teams. Update `data.js`.

### N-03 — Admin: apply API-Football data to bracket
Currently the API-Football refresh only caches data. A future "Apply cached results" button in admin could parse the cache and update `results` in state — removing the need to enter scores manually.

## Medium-term

### M-01 — Tie-breaker rule
When two entries have the same total points, the current sort is stable (no defined tiebreaker). Decide and document the tiebreaker (e.g., who submitted first, or who picked the correct champion).

### M-02 — Supabase Realtime subscriptions
Currently sync happens only on page focus and visibility change. A Supabase channel subscription would push updates to all open tabs instantly without polling. Requires loading `@supabase/realtime` or using the existing client's `.channel()` API.

### M-03 — Japanese (ja) language
CLAUDE.md historically mentioned `ja` as a fourth language, but `i18n.js` only has pt-BR, es, en-US. If Japanese participants join, add a `ja` object and a 🇯🇵 button.

### M-04 — Visual bracket tree
Replace the linear match-card list in the picks form with an actual bracket diagram showing the progression tree. Would improve UX for participants who want to see how their bracket connects.

## Long-term / future tournaments

### L-01 — New tournament bootstrap
Before the next tournament, update in `js/config.js`:
- `siteVersion` — bump version string
- `storeKey` — new key to avoid stale state from previous tournament
- `cutoffIso` / `cutoffLabel` — new deadline
- Payment handles if changed

In `js/data.js`:
- Replace all `groupMatches` with the new tournament fixture data
- Replace all `knockoutMatches` with new bracket template
- Update `strength` ratings if needed
- Update `updatedLabel`

In `js/i18n.js`:
- Update cutoff date strings in all three languages

### L-02 — Server-side admin authentication
For a higher-stakes tournament, replace the SHA-256 client-side hash with a proper backend (e.g., Supabase Auth or a password-protected Edge Function endpoint). This eliminates the ability to brute-force the admin password offline.

### L-03 — Serverless API proxy for API-Football
Instead of exposing the API key in browser source, route requests through a Supabase Edge Function or Cloudflare Worker. This allows enabling live score updates safely.

### L-04 — Entry deadline: server-side enforcement
Replace the client-side `isPastCutoff()` check with a Supabase RLS policy that rejects inserts after the cutoff timestamp. This prevents clock-manipulation exploits.

## Explicitly not planned

The following were considered and rejected:

- **Mobile app / PWA:** app works fine as a mobile web page; native app is unnecessary overhead.
- **Real-time odds display:** Polymarket odds influence the simulator internally but won't be surfaced in a UI panel (avoids gambling-adjacent UX concerns).
- **Automated WhatsApp messages:** no WhatsApp Business API; the group link is sufficient.
- **Multiple pools:** the current architecture supports one pool (`id = "main"`). Multi-pool support would require structural changes and is not needed for the friends/family use case.
