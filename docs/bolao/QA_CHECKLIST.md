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

## Scoring/ranking parity — run before ANY PR, always, no exceptions

**This is the part of the site that can never be broken — real money is paid out based
on it.** Added after a July 2026 audit found `send_result_email.py` had silently drifted
from `app.js` (wrong R16/QF bracket pairing, missing bonus points — see CHANGELOG v4.57).
The site itself can't internally disagree with itself (one `scoreEntry()` used
everywhere), but the standalone Python email script re-implements the same logic and has
no way to catch drift automatically without an explicit check.

- [ ] Run `python3 bolao/scripts/audit_scoring.py` — exit code 0 and all 5 checks pass.
      `send_result_email.py --auto` also runs this automatically before every send and
      refuses to email anyone if it fails, but run it by hand too before opening a PR.
- [ ] State explicitly in the PR/summary that this was run, even if the change looks
      unrelated to scoring — say so either way ("audit re-run, still passes" or the
      specific failure and fix). Two real bugs were found this way in code nobody thought
      was scoring-related at the time.
- [ ] If you touched `bolao/js/data.js`'s bracket, `bolao/js/config.js`'s `scoring`/`bonus`
      values, or anything in `bolao/scripts/send_result_email.py`, also manually re-check
      the tiebreak cascade (total → exact scores → podium hits) still matches across the
      website ranking, the admin's manual email builder, and the auto-email script — the
      audit script covers the Python side's internal correctness and its parity with
      `data.js`, but a simultaneous change to both the bracket and the JS scoring logic in
      the same PR is still worth eyeballing directly.

<!-- AUTO:CROSS_APP_QA:START -->
## Cross-app QA (this checklist is Copa-specific)

This file only covers `bolao/` (Copa do Mundo 2026). The Copa is **in production**, so treat
any UI/component, accessibility, security, database, email, receipt, admin, or infrastructure
change made here as something that must also be checked against `bolao/br2026/` and
`bolao/cdb2026/` before the task is considered done — per the propagation rule in `CLAUDE.md`
and `docs/bolao/PLATFORM_GOVERNANCE.md`.

For the full cross-app checklist (pre-change through post-change, static checks, and the
security/quality grep sweep shared by all three apps), run
`docs/bolao/QA_MASTER_CHECKLIST.md` in addition to this file. If a change here reveals or
resolves a divergence with the other two apps, update `docs/bolao/CONSISTENCY_MATRIX.md`.
<!-- AUTO:CROSS_APP_QA:END -->
