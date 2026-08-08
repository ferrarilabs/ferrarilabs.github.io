# Powerball — Incident Review

Confirmed against `origin/main` git history, current code, and (for the finance number) live
Supabase/production checks performed during this session. No root cause below is asserted without
a commit hash, line number, or direct observation backing it.

---

## Incident 1 — Automatic result email never fires

**Symptom**: participants expect an automatic email after a draw; none arrives unless someone
manually notices and opens the site.

**Impact**: P0. Participants have no way to know if they won without checking themselves; the
entire point of the "resultado buscado automaticamente" promise on the page
(`index.html:102`, "sem digitação manual") is not met in the sense participants would assume
("automatic" = "happens without me doing anything").

**Root cause — confirmed**: `sendResultEmail()` (`js/app.js:263`) is only ever called from inside
`renderDraw()` (`js/app.js:429`), which only runs on `DOMContentLoaded` or a draw-selector change
— i.e., **only when a browser loads the page**. There is no scheduler, cron, GitHub Action, or
server process of any kind wired to this app. Confirmed via `ls .github/workflows/ | grep -i
powerball` → zero results, and via reading the full call graph of `sendResultEmail()` — its only
caller is inside a browser event handler.

**Evidence this was known and solved once, then lost**: commits `adc4fde` ("Add GitHub Actions
workflow for automatic Powerball results email") and `dfda53f` ("Add automatic Powerball result
fetcher and scheduled email sender", a server-side `fetch_and_send_results.py` + a `*/10min` cron
workflow) exist and are real, substantial work — but only on the abandoned branch
`origin/claude/lottery-countdown-timer-ns0nlt`, **97 commits behind current `origin/main`** and
never merged. The automation was built once, then the branch was abandoned as the app's data
model evolved (participant schema, multi-lottery `LOTTERY_GAME_TYPES`, etc. all changed
afterward), and nobody ported it forward. `main` has been running the client-side-only, no-cron
version this whole time.

**Control absent**: no server-side trigger; no monitoring for "draw happened, no email sent";
no owner notified when the automatic path silently does nothing.

**Fix (this branch)**: local outbox model + fake-provider tests (see
`POWERBALL_EMAIL_RELIABILITY.md`) that separate "decide an email should exist" from "actually
send it," so a real worker (Part 8 of the audit spec) can be added later without re-deriving this
analysis. Not activated in production by this branch — no workflow file changes ship live.

---

## Incident 2 — Manual email sent with wrong content

**Symptom**: a manually-triggered result email reportedly had incorrect content.

**Impact**: P0 — an email participants use to know if they won, showing wrong numbers/amounts/
draw, directly damages trust and could cause a real dispute over money.

**Root cause — confirmed mechanism, not a single confirmed instance**: `getEffectiveDraw()`
(`js/app.js:67-74`) merges `draw.result`/`draw.profit` from the committed `data.js` with whatever
is cached in **that specific browser's** `localStorage["powerball_local_results_v1"]`. Nothing
about this merge is shared or coordinated across browsers/sessions. Two concrete failure
mechanisms follow directly from the code, both real and reproducible, not hypothetical:

1. **Stale local override outlives the committed data.** If a browser fetched and cached a result
   locally (e.g. during a flaky/incomplete API response, or before a later correction was
   committed to `data.js`), that browser will keep showing/emailing the stale cached version —
   `getEffectiveDraw()` always prefers the local override when present (`app.js:69-72`), with no
   expiry, no version check against `data.js`, no invalidation on deploy.
2. **Two browsers independently compute two different "official" results** if the NY Open Data
   feed briefly returns partial/inconsistent rows (no stability re-check exists in this app,
   unlike the CDB2026/Copa Python scripts, which re-fetch after 20s and require two consecutive
   matches before trusting a score — see `bolao/cdb2026/scripts/send_result_email.py`'s
   `run_auto()`). Powerball's `fetchOfficialResult()` (`app.js:218`) trusts the first response,
   once, with no confirmation pass.

**Control absent**: no snapshot immutability (content is recomputed live at send time from
whatever the browser currently has in memory/localStorage, not from a fixed payload decided once);
no stability re-check before trusting a fetched result; no record of what was actually sent to
compare against later.

**Fix (this branch)**: the outbox model's `payload_snapshot` (Part 5 of the spec) makes email
content immutable once a job is created — the renderer never re-reads live state at send time.
Not wired into the live client-side path in this branch (would require the worker from Part 8,
deliberately not activated in production per the spec's prohibition list).

---

## Incident 3 — Admin doesn't work

**Symptom**: clicking "🔐 Admin" does nothing; data entered anywhere admin-shaped is never saved.

**Impact**: P0 — this is also why the "sent all participants + paid amounts today" message earlier
in this session went nowhere: there was and is no working save path. Every participant/payment
update to date has happened via hand-editing `data.js` and a git commit, not through this UI.

**Root cause — confirmed, with a paper trail of commits that claim otherwise**:

- `index.html` contains only `<a href="#" id="pbAdminLink">🔐 Admin</a>` (`index.html:108`). No
  `pbAdminLoginModal`, `pbAdminPanel`, `pbAdminPasswordInput`, `pbAdminLoginBtn`,
  `pbAdminLoginCancelBtn`, `pbAdminCloseBtn`, `pbAdminLoginError` — none of the ~7 DOM IDs
  `js/app.js`'s admin code references exist anywhere in the HTML. Confirmed via
  `grep -n "pbAdmin" index.html`.
- `js/config.js` has no `adminPasswordHash` field at all — confirmed via
  `git log -p --all -- js/config.js | grep adminPasswordHash` returning **zero matches across
  the entire history of the file**. `adminLogin()` (`js/app.js:465`) computes a SHA-256 hash of
  whatever password is typed and compares it to `POWERBALL_CONFIG.adminPasswordHash`, which is
  `undefined` — the comparison can never be true. Even if the missing modal existed, login would
  be permanently impossible with any password.
- **Commit message vs. diff mismatch**, the actual root cause of why this looks like a shipped
  feature: commit `0756b0b` ("security: admin panel + Supabase schema for sensitive data")
  claims, with checkmarks, "Admin panel (4 tabs)", "Login modal", "Admin panel slides in from
  right" — its actual diff is **one new markdown file**,
  `bolao/loterias/powerball/docs/DATABASE_SETUP_SUPABASE.md`, zero lines of HTML/CSS/JS. Commit
  `93d5446` ("feat: implement admin panel UI...") claims "Implemented admin login modal",
  "Admin panel slides in from right after login (4 tabs ready)" — its actual `index.html` diff
  adds **only the 4-line footer with the link**; the modal/panel markup described in the message
  was never written. The `js/app.js` and `css/styles.css` changes in that same commit add the
  *behavior* (login function, session timeout, CSS for a panel) with nothing in the HTML for that
  behavior to attach to.

**Control absent**: no CI check that a referenced `getElementById()` target exists; no manual QA
step before commit despite `docs/bolao/QA_CHECKLIST.md` existing for other bolão apps (Powerball
is not in scope for that checklist); no smoke test that clicking the one interactive control on
the page does anything.

**Immediate mitigation already shipped** (outside this branch, this session): `data.js` is being
hand-edited and committed directly by Eduardo + Claude as a stopgap (see commits `8b45c01`,
`6d21052`, `da774b3`). This is documented as the *interim* state, not a fix — see
`POWERBALL_ADMIN_FUNCTION_MATRIX.md` for what a real Admin needs.

**Fix (this branch)**: documented exhaustively (this file + the Admin Function Matrix); a real,
working, authenticated CRUD admin is out of scope for a "local, no-deploy" audit branch by
definition (it needs a real backend + real auth, which this branch's constraints explicitly
forbid standing up in production) — filed as the top P0/P1 item in
`POWERBALL_PROFESSIONALIZATION_REPORT.md` for a dedicated follow-up.
