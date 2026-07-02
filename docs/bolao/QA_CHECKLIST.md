# QA Checklist — Bolão do Ferrari

Run after every deploy. Current version: **v4.0-clean**.

## Setup

```bash
# Local preview
python3 -m http.server 8080
# Then open: http://localhost:8080/bolao-teste/
```

## Registration flow

- [ ] Fill all 32 knockout bracket matches (73–104) with valid scores and advance sides.
- [ ] Submit with valid entry name, payer name, email, payment method. Entry is saved.
- [ ] Receipt box appears with a `BOLAO-XXXXXXXX-YYYYMMDD` code.
- [ ] "Open receipt / save PDF" opens a new tab with self-contained HTML (Blob URL, not `document.write`).
- [ ] "Download HTML" downloads the receipt file locally.
- [ ] "Send by email" fires EmailJS and shows success toast.
- [ ] Draft is cleared from sessionStorage after successful save.
- [ ] Entry appears in Ranking and Participants sections immediately.

## Validation

- [ ] Submit with a missing match score → alert names the specific match.
- [ ] Submit with a tied score and no advance side → blocked with alert.
- [ ] Submit with score >20 → value is clamped or rejected.
- [ ] Submit with score ≥10 goals (e.g. 10×0) → confirmation dialog appears.
- [ ] Submit with 8+ matches sharing identical score → repetition warning dialog.
- [ ] Submit with invalid email → rejected before save; email field focused.
- [ ] Score inconsistency (winner ≠ advance side) → blocked with alert.

## Draft restore

- [ ] Fill some scores → refresh page → dialog offers to restore draft → accept → scores restored.
- [ ] Draft older than 2 hours is silently discarded (simulate by altering `ts` in sessionStorage).
- [ ] Decline draft restore → draft is cleared → clean form.

## Simulators

- [ ] "⚡ Auto simulate" fills all 32 matches; asks confirmation if picks exist.
- [ ] "🎲 Random simulate" fills all 32 matches with random scores.
- [ ] Both simulators resolve bracket slots correctly (later rounds show actual team names, not "Winner Match N").
- [ ] Simulators are disabled after cutoff.

## Admin panel

- [ ] Wrong password → attempt counter increments; after 5 attempts → locked for 15 min.
- [ ] Correct password → admin area shown; login form hidden.
- [ ] Admin session expires after 30 min (test by setting `adminUntil` to a past timestamp in sessionStorage).
- [ ] Mark payment as paid → checkbox persists after reload.
- [ ] Enter a real result for Match 73 → ranking updates points live.
- [ ] Delete an entry → entry disappears from ranking, participants, and admin receipts.
- [ ] "Baixar CSV (master)" produces a valid CSV with headers; opens in Excel (CRLF line endings).
- [ ] "Backup CSV" includes all 32 match picks inline.
- [ ] "Backup JSON" downloads a valid JSON file with full state.
- [ ] "Master HTML" downloads a styled HTML table.
- [ ] "Popular dados de teste" creates 3 demo entries (Ana/Bruno/Carlos Demo).
- [ ] "Limpar todos os dados" confirms twice then wipes data and re-renders empty state.
- [ ] "Atualizar API-Football" shows "not configured" alert when key is empty (expected default).
- [ ] Logout → admin area hidden; login form shown.
- [ ] `guardAdmin()` blocks all admin actions if session is expired.

## Language switching

- [ ] Click 🇧🇷 PT-BR → all visible strings update (nav, rules, receipt labels, phase labels, alerts).
- [ ] Click 🇲🇽 ES-MX → same.
- [ ] Click 🇺🇸 EN-US → same.
- [ ] Language persists across page reloads.
- [ ] Phase labels ("16 avos de final", "Oitavas de final", etc.) translate correctly.

## Cutoff enforcement

- [ ] Before cutoff: save button enabled; bracket inputs enabled.
- [ ] After cutoff: save button disabled; bracket inputs disabled; simulators disabled.
- [ ] Countdown timer shows days/hours/min/sec and updates every second.
- [ ] Past cutoff: countdown shows "Encerrado" / "Closed".

## Games section

- [ ] Group stage (GS-01–GS-72) all displayed with correct scores and status.
- [ ] Knockout matches (73–104) shown with correct status.
- [ ] "Finalizado" chip appears for completed matches; "A jogar" for scheduled.
- [ ] Venue shown when available.

## Payment section

- [ ] CashApp, Zelle, Venmo all shown with correct handles.
- [ ] Zelle QR image displayed.
- [ ] Payment links open correct external URLs.
- [ ] WhatsApp group button links to the group.

## Supabase sync (if enabled)

- [ ] Entry created in browser A → refresh browser B → entry appears.
- [ ] Disconnect internet → create entry → reconnect → entry syncs to Supabase.
- [ ] Offline mode: sync failure toast does not prevent local save.
- [ ] Focus/visibility change triggers remote reload (switch tabs → come back → data refreshed).

## Security checks

- [ ] CSP header present in HTML source (inspect network → index.html → response meta).
- [ ] No `document.write` calls (search source).
- [ ] All user data in DOM is HTML-escaped (inspect elements for raw `<` or `>` chars).
- [ ] Admin password field is cleared after login.
- [ ] Receipt popup gracefully handles browser popup blocker (fallback download shown).

## Regression checks

- [ ] Bracket slot propagation: when Match 73 winner is set, Match 89 shows correct teams.
- [ ] Final podium (champion/runner-up/3rd/4th) derives correctly from full bracket walk.
- [ ] Scoring: exact score gives 10pts; advance only gives 5pts; one goal match gives 1pt.
- [ ] Bonus: champion match correctly identified as Match 104; 3rd place as Match 103.

## Scoring/ranking parity — run before ANY PR that touches results, ranking, bracket data, or `bolao/scripts/*.py`

Added after a July 2026 audit found `send_result_email.py` had silently drifted from
`app.js` (wrong R16/QF bracket pairing, missing bonus points — see CHANGELOG v4.57).
The site itself can't internally disagree with itself (one `scoreEntry()` used
everywhere), but the standalone Python email script re-implements the same logic and
has no way to catch drift automatically. Check by hand every time:

- [ ] `bolao/scripts/send_result_email.py`'s `MATCH_TEAMS` dict exactly mirrors every
      `teamA`/`teamB` pair in `bolao/js/data.js`'s `knockoutMatches` (including R16/QF
      `W`/`L` slot references — cross-check match-by-match, not just row count).
- [ ] Bonus points (champion/runner-up/3rd/4th: 25/15/10/5) are present in whatever
      function computes an entry's *total* in both `app.js` (`scoreEntry`) and
      `send_result_email.py` (`score_entry_total`) — not just used for tiebreak order.
- [ ] Run a full mock-tournament simulation against `send_result_email.py` (all 32
      knockout matches decided, one entry with a "perfect" bracket) and confirm the
      champion resolves correctly through all 4 rounds and the total equals
      `(match points) + 25 + 15 + 10 + 5`. See v4.57's commit for a working test script.
- [ ] Tiebreak cascade order (total → exact scores → podium hits) matches across the
      website ranking, the admin's manual email builder, and `send_result_email.py`.
