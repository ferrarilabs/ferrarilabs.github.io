# Football Operational Hardening — Checkpoint A: Incident Audit

Branch: `football-operational-hardening`. Scope: `bolao/copa2026/`, `bolao/br2026/`,
`bolao/cdb2026/`, `bolao/shared/`. `bolao/loterias/powerball/` explicitly out of scope and
untouched throughout this work.

This document records real, evidenced findings from reading the current codebase — not
hypothetical or guessed problems. Section B's failing regression tests are written directly
against these findings.

## 1. Direct browser → ESPN calls (no CORS guarantee)

All three apps fetch live data straight from ESPN's undocumented public endpoints in client-side
JS, with no server-side intermediary, no normalization, and no validated fallback source.

| App | File | Evidence |
|---|---|---|
| Copa2026 | `bolao/copa2026/js/app.js` | 4 direct `fetch()` calls to `sports.core.api.espn.com` / `site.api.espn.com`: line 3601 (probabilities), 3694 (event summary), 3758 (scoreboard), 3786 (event summary) |
| BR2026 | `bolao/br2026/js/app.js` | 4 call sites using `C.espn.standingsUrl` / `scoreboardUrl` / `scheduleUrl` (`bolao/br2026/js/config.js` lines 80-82) via shared `fetchJson()` wrapper: line 763 (standings), 890 (scoreboard summary), 902 (live scoreboard), 1295 (full schedule) |
| CDB2026 | `bolao/cdb2026/js/app.js` | 2 call sites using `C.espn.scoreboardUrl` (`bolao/cdb2026/js/config.js` line 96) via the same `fetchJson()` pattern: line 2756 (event summary), 2779 (live-tie candidates) |

None of these have a validated, versioned, checked-in JSON fallback. If ESPN blocks CORS,
rate-limits, or changes shape, the live site has no controlled degradation path other than each
call site's individual `try/catch` returning `null`.

**Documented production incident (real, not hypothetical):** a code comment in
`bolao/cdb2026/js/app.js` around line 2766-2772 records that on 2026-08-01 a real live
Vasco×Fluminense match failed to appear as "live" on the site because ESPN's scoreboard endpoint
returned the team name "Vasco da Gama" while the curated `bolao/cdb2026/js/data.js` fixtures use
"Vasco" — a plain string-equality name match failed silently, with no error surfaced to admins or
users. The current workaround is a hand-maintained alias map
(`CDB_ESPN_NAME_ALIASES = { "Vasco da Gama": "Vasco" }`, line ~2772) that has no test coverage and
has to be updated by hand every time ESPN changes or adds a naming variant. The same pattern
(`ESPN_SCOREBOARD_NAME_ALIASES` / `normalizeEspnTeamName`) exists independently in
`bolao/br2026/js/app.js`, duplicated rather than shared.

No reusable server-side ESPN-fetch script exists anywhere under `bolao/*/scripts/` — the only
existing fetch script in the repo is `bolao/loterias/powerball/scripts/fetch_and_send_results.py`,
which is Powerball-specific (different data source, different scoring domain) and out of scope
for this branch. Section C will need a new script per app or a new shared module — not a reuse of
existing code.

## 2. CDB2026 — no penalty data model, so the target scenario cannot render today

`bolao/cdb2026/js/app.js`, `tieProgressDisplay()` (~lines 693-740) and `aggregateFromMatches()`
(line 686) compute the two-leg aggregate purely from `goalsHome`/`goalsAway` on each leg's match
record. The function's own comments (lines 703-709) state explicitly:

> "CDB2026 has NO admin-enterable penalty-score field anywhere in its data model ... `penalties`
> below is always null — intentionally, not a bug ... never fabricate a penalty score for data
> that has nowhere to come from."

Confirmed by reading the surrounding code: `penalties: null` is hard-coded at every return site
in `tieProgressDisplay()` (lines 723, 733, 740). There is no `penaltiesHome`, `penaltiesAway`, or
equivalent field anywhere in `bolao/cdb2026/js/data.js`'s tie/match shape, and no admin UI control
for entering one (checked the admin tie-form block around line 3528-3600 — it only ever computes
`aggregateBlock` from `aggregateFromMatches`, no penalty inputs).

**Consequence for the task's mandatory scenario** (Ida 1×0, Volta 1×0, Agregado 1×1, Pênaltis
5×4, Classificado Time Alfa): this cannot be reproduced or rendered today, not because of a
combined-score rendering bug (the "6×5" bug class), but because the data simply doesn't exist yet.
The "never combine aggregate+penalties into one number" requirement is currently satisfied only in
the degenerate sense that penalties are never shown at all. Eduardo has authorized (see branch
history / task instructions) adding additive, backward-compatible fields (`penaltiesHome`,
`penaltiesAway`, `penaltiesWinnerTeamId`, `advancingTeamId`) to close this gap without touching
regulation score, aggregate computation, scoring, ranking, or historical persistence.

## 3. Scope confirmation

- Verified no changes made to `bolao/loterias/powerball/` at any point during this audit.
- No emails sent, no Supabase writes, no production data touched — this checkpoint was
  read-only investigation (`grep`/`Read` only, no `Write`/`Edit` calls against app code).

## Next step (Checkpoint B)

Write regression tests that fail against the current state for both findings above:

1. A CDB2026 test asserting the mandatory scenario's four pieces of information (match score,
   aggregate, penalties, advancing team) are exposed as distinct fields/values — this must fail
   today since `penalties` is hard-coded `null`.
2. A test/fixture demonstrating each app's live-data path has no server-side/validated fallback
   when the direct ESPN fetch fails — proving the CORS-dependency gap described in section 1.
