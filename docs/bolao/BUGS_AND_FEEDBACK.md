# Bugs and Feedback — Bolão do Ferrari

## Current version: v4.0-clean (2026-06-27)

---

## Known bugs (open)

| # | Description | Severity | Notes |
|---|---|---|---|
| B-01 | API-Football refresh does not auto-update `data.js` bracket data. Admin must manually reconcile. | Low | By design for now; avoids breaking validated bracket structure. |
| B-02 | Polymarket integration exists in config but the smart simulator does not visibly surface which market was matched or whether odds were used. | Low | Informational only; no user-facing display needed unless requested. |
| B-03 | Countdown timer hardcodes "dias/hrs/min/seg" in PT-BR regardless of active language. | Low | Labels are not in i18n. |
| B-04 | Data.js `flags` object has `Scotland` duplicated as a key (both `"Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿"` entries). | Cosmetic | Second entry silently overwrites first; no functional impact. |
| B-05 | Several Round of 32 team slots are still "3rd A/B/C/D/F" style placeholders because third-place group qualifiers are not yet determined. | Scheduled | Will resolve when group stage completes (Jun 27–28). |

---

## Fixed bugs — v4.0-clean (from v3.x history)

| Bug | Fixed in |
|---|---|
| CSV line endings were LF — broken in Excel on Windows | v3.0 (now CRLF) |
| Admin plaintext password comment left in source | v3.0 (removed) |
| Alternative fallback admin hash existed alongside primary | v3.0 (removed) |
| EmailJS `init` called without `limitRate` throttle | v3.0 (throttle: 30000ms) |
| Email payload included fields beyond `html_message` | v3.0 (reduced to `html_message` only) |
| Score validation ran only on display, not on actual save | v3.0 (validated in `readEntryFromForm`) |
| Score out of 0–20 range was accepted | v3.0 (parseScore clamps) |
| Winner/advance side inconsistency was not caught | v3.0 (validated before save) |
| Admin had no logout | v3.0 (logout added) |
| Admin could not delete entries | v3.0 (delete + email notification) |
| Admin payment/result events were per-element, not delegated | v3.0 (event delegation) |
| `scoreEntry` was called multiple times per ranking row | v3.0 (called once) |
| Participants list made multiple state reads | v3.0 (single read) |
| Receipt used `document.write` | v3.0 (Blob URL) |
| Simulator ran after cutoff and silently overwrote | v3.0 (blocked + confirm) |
| Dynamic team names were not HTML-escaped | v3.0 (escapeHtml applied) |
| Language dropdown was visible (UX issue) | v3.3.4 (replaced with flag buttons) |
| UK nation flag emojis were incorrect | v3.2.1 (Scotland/Wales/England fixed) |
| Initial "Time A / Time B" flash before teams resolved | v3.2.1 (score-label-A/B deferred) |
| `i18n-repair.js` patch file polluted global scope | v4.0 (removed; i18n fully in i18n.js) |
| PayPal payment method included but not used | v4.0 (removed) |
| Multiple legacy `FIX_LOG_*` patch files cluttered docs | v4.0 (removed) |

---

## User feedback received

All feedback is from Eduardo Ferrari (app owner, also primary tester) unless otherwise noted.

- **Timer:** requested seconds visible in countdown. Added in v3.3.4.
- **Language toggle:** requested flags instead of dropdown. Implemented in v3.3.1.
- **Receipt:** requested no popup-dependent flow. Implemented "Download HTML" fallback.
- **Rules section:** scoring table was missing; restored in v3.3.1.
- **Supabase:** requested optional remote sync so multiple devices share state. Added in v3.3.
- **Transparency:** requested disclaimer text about informal nature and receipt responsibility. Added to Rules section.
- **WhatsApp:** requested group link and QR accessible from the app. Added in v4.0.
- **Venmo/PayPal:** PayPal removed in v4.0 as it was not actually used.
- **Live scoreboard (suggested by Alan, a participant):** requested a live stream showing game results and points on the site (originally "live stream q mostra o resultado do jogo e a pontuacao"). Clarified as live score/points, not video. Added in v4.25: public auto-refreshing live score badge on the Jogos tab (ESPN, no admin login needed) + ranking auto-refresh every 90s.
- **Per-match points in picks table (Eduardo):** requested showing how many points each entry earned per match, not just the total. Added in v4.26: `picksTable` now shows the real result and points earned for every knockout match, alongside each pick.
- **Live points dropdown + match clock (Eduardo):** requested a dropdown under each live match showing everyone's provisional points at the current score, plus a minutes:seconds match clock instead of just the minute. Added in v4.27.
- **Mobile "not seeing changes" + ugly next-match countdown (Eduardo):** reported changes not showing on phone, and the next-match countdown timer wrapping badly on mobile. Root causes found and fixed in v4.31: stale `?v=` cache-busting params (stuck at 4.19 since several releases back) and a CSS specificity clash between `.count-grid`'s mobile 2-column override and the 3-cell next-match timer.
- **Rank-movement arrows on the live match points too (Eduardo):** requested the same up/down arrows as the main ranking, but scoped to each live match's provisional points table — like Globo Esporte's real-time Brasileirão table. Added in v4.32. Eduardo also confirmed: the database only updates when a match officially ends, never mid-game — the live points/arrows are purely a browser-side preview and never write to Supabase (already true by design; note text made more explicit about this in v4.32).
- **Live card redesign, Google style (Eduardo):** sent a screenshot of Google's live World Cup scoreboard (flag badge, team name below, big score, centered "Live" pill + running clock) and asked for the hero's live card to look like that. Redone in v4.33.
- **Live points list wasn't visible enough (Eduardo):** the per-match provisional points list existed but only behind a toggle on the Jogos tab — Eduardo expected it directly under the score on the hero live card. Moved there (always visible) in v4.34.
- **Tiebreaker rule finally decided (Eduardo), triggered by a WhatsApp screenshot of two entries tied for 1st with the joking caption "esse sistema é machista!":** cascade is (1) most exact scores, (2) most correct champion/runner-up/3rd picks, (3) if still tied, shared position — prize for that placement split manually since payouts aren't automated. Implemented consistently in the web ranking, the in-browser email builder, and the Python cron email script (`send_result_email.py`) in v4.36. Resolves ROADMAP M-01.
- **Exact-score counter in picks view (Eduardo):** wanted people to see, at the bottom of "Ver palpites," how many exact scores an entry got right — so ties in the ranking are self-explanatory against tiebreaker level 1. Added in v4.41.
- **Live clock "resets" when leaving and returning to the page, noticed during Spain's match (Eduardo):** root cause: ESPN's free feed lags real time (up to ~1-2 min, worse right after resuming from backgrounded), and a fresh poll's clockSeconds could be behind what the interpolated display already showed, making it jump backward. Fixed in v4.47 with a monotonic guard (`mergeLiveClock`) that keeps counting forward through small lag, while still allowing legitimate large resets (halftime, extra time). Note: `bolao-teste/` was renamed to `bolao/` in v4.44 by a separate concurrent session; this fix and future bolão work should target `bolao/js/app.js`.
- **Follow-up — clock still reset on every page refresh (Eduardo):** the v4.47 guard only had a "previous" value to compare against while the tab stayed open in memory; a full reload wiped it, so the first poll after refresh had nothing to protect against ESPN's laggy value. Fixed in v4.48 by persisting the last known clock per match to `localStorage`, so the guard survives reloads too.
- **Probability bar only in Jogos tab, wanted it live like Google/Coinbase/Polymarket (Eduardo):** the prob bar feature the Mac session shipped that morning only rendered inside the Jogos tab's match cards, not on the prominent hero live card. Added in v4.49 (shared `liveProbBarsHtml`, no duplicated logic). Also asked to pull the "real" probability from wherever Google sources it for their live scoreboard — there's no public access to whatever proprietary data Google uses; closest legitimate option is ESPN's own undocumented win-probability API, added as a best-effort upgrade with automatic fallback to the site's own Poisson model (confirmed via AskUserQuestion this was the preferred approach given the uncertainty).
- **Narrow prob-bar label overflow ("Austria 3%" spilling outside its sliver), noticed by Eduardo right after the above:** fixed same session — labels under 12% width are hidden, tooltip still carries the number.
- **Follow-up — don't hide the % too, just the name (Eduardo):** the first fix hid the entire label below 12%, leaving a blank sliver. Changed in v4.50 to always show at least "N%", dropping only the team/draw name when there's no room.
- **If ESPN's real probability doesn't pan out, use match stats instead (Eduardo):** suggested recalculating on goal changes (already happens every poll) or pulling match statistics as a hidden input to sharpen the estimate. Added in v4.51: shots-on-target/possession fetched from ESPN's summary endpoint, blended into the fallback Poisson lambdas (70/30) when the dedicated win-probability endpoint isn't available. Stats aren't shown anywhere in the UI, only used as calculation input.
- **Live points table positions out of order, caught via screenshot (Eduardo):** the "Pos." number (rank within the overall provisional standings) and the visual row order (sorted by this match's own points) used different tie-break rules when two entries were tied on provisional total, so a row labeled "3" could render above a row labeled "2". Fixed in v4.52 — both now use the identical comparator, rows sort directly by the same `provPos` shown to the user.
- **Rank movement arrows (Eduardo):** requested up/down arrows on the ranking showing whether an entry's position improved or dropped since the last score change, similar to a league table (referenced Globo Esporte's Brasileirão table). Added in v4.27.
- **Live points table positions out of order, caught via screenshot (Eduardo):** the "Pos." number (rank within the overall provisional standings) and the visual row order (sorted by this match's own points) used different tie-break rules when two entries were tied on provisional total, so a row labeled "3" could render above a row labeled "2". Fixed in v4.52 — both now use the identical comparator, rows sort directly by the same `provPos` shown to the user.
- **Goal scorer + minute in the live scoreboard, from a screenshot of Google's Spain vs Austria card (Eduardo):** wanted the same "M. Oyarzabal 36' / P. Porro 66'" list Google shows under the score. Added in v4.53 — pulled from the same ESPN scoreboard event already used for score/clock (`competitions[].details`), no extra request, shown on both the hero live card and the Jogos tab card. Best-effort like the probability features: renders nothing for a match if ESPN doesn't return that detail.
- **"None of the recent changes are live, even in incognito" (Eduardo), 2026-07-02:** root cause wasn't the code — GitHub Pages' own "Deploy to GitHub Pages" step failed silently for the v4.48–v4.51 merge (build succeeded, deploy step errored, most likely a race between the PR's squash-merge push and the `sync_version.yml` auto-bump push firing seconds apart). No error surfaces in this app when that happens; only visible by checking the repo's Actions tab. Fixed by re-running the failed deploy job. Worth a periodic sanity check after merges: confirm the "pages build and deployment" run for the latest commit actually shows a green checkmark, not just that the PR merged.
- **Match-end banner exposed an admin action to every visitor, caught via screenshot (Eduardo):** "Isso não pode aparecer para todos!!" — the public "Jogo encerrado!" banner (shows to anyone when a knockout match ends) included a "🔐 Admin → enviar emails" button even for logged-out visitors, which just navigated to the Admin section — surfacing an admin-only workflow to the whole bolão. Fixed in v4.54: non-admin visitors now only see the plain "Jogo encerrado!" notice with a dismiss button; the "Enviar emails agora" action only renders for a session that's already authenticated as admin.

---

## Feedback wishlist (not yet implemented)

These were discussed but not built. Documented here to avoid re-asking.

- Real-time multi-browser sync via Supabase Realtime subscriptions (currently only syncs on focus/visibility).
- Japanese (ja) language support — mentioned in early CLAUDE.md but never implemented in i18n.js.
- API-Football auto-update of bracket: when real match results come in, admin should be able to apply them to `data.js` without manual editing.
- A visual bracket tree view (bracket diagram) instead of match cards list.

---

## How to report a new bug

1. Open the app at `https://ferrarilabs.github.io/bolao-teste/`.
2. Open browser DevTools (F12) → Console tab → look for errors.
3. Send Eduardo the console output, browser/OS, and steps to reproduce via WhatsApp or email (emferrari@gmail.com).
