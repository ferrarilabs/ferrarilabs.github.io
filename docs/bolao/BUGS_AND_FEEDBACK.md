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
- **Rank movement arrows (Eduardo):** requested up/down arrows on the ranking showing whether an entry's position improved or dropped since the last score change, similar to a league table (referenced Globo Esporte's Brasileirão table). Added in v4.27.

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
