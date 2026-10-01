# API-Football as primary live provider — assessment

**Bottom line: UNVERIFIED on coverage, mapping implemented and tested against SYNTHETIC fixtures only.** No credential exists, no live call was made, and the provider's official documentation, pricing and terms pages could not be read in this session (every `api-football.com` / `api-sports.io` host returned HTTP 403 through the sandbox proxy). Nothing below that is marked VERIFIED comes from the provider's own pages.

## 1. Coverage — Série A 2026 and Copa do Brasil 2026

| Item | Status | Evidence / what is needed |
|---|---|---|
| Série A league id | **UNVERIFIED** — configured as `71` (`providers/api_football.js` `LEAGUES.br2026`) | confirm with `GET /leagues?country=Brazil&season=2026` |
| Copa do Brasil league id | **UNVERIFIED** — configured as `73` | same call |
| Season value | UNVERIFIED — `2026` | same call |
| Coverage flags (fixtures/events/lineups/statistics) | **UNVERIFIED** | `coverage` object of the `/leagues` response |
| Free plan can read season 2026 | **UNVERIFIED — the critical open question** | third-party pages only say "historical seasons limited"; test with the free key |
| Prior project evidence | Issue #425 (cited in `bolao/shared/js/where_to_watch.js`) *discarded* API-Football for broadcast data "por falta de evidência de cobertura"; `bolao/copa2026` once used it for the World Cup (`league: 1`, `season: 2026`, `status.short` ∈ FT/AET/PEN), disabled by default | does not prove Brazilian coverage |

Third-party pages (not official) agree on: Free = 100 requests/day, Pro ≈ $19/month with 7,500/day (thestatsapi.com, apisports.net); Ultra/Mega figures come from search snippets only. A third-party warning worth heeding: missing coverage can return HTTP 200 with an empty `response` — the adapter treats `errors` as failure but cannot tell "no live match" from "no coverage"; the proof plan checks coverage explicitly.

## 2. Field mapping to the canonical payload (implemented: `providers/api_football.js`)

The canonical match is what ESPN produces today; consumers key on it (`football_live_store.js`, heroes, live standings). Mapping, per fixture:

| Canonical field | Source | Notes |
|---|---|---|
| `id` | **calendar entry** resolved by team names + date (±36 h) or an explicit `identityMap` | the apps match live data to the schedule by ESPN event id (`_schedule.findIndex(g => g.id === m.id)`). A provider id would break them. Unresolvable/ambiguous fixtures are dropped and reported (`unmapped`) |
| `homeTeam/awayTeam`, `homeTeamId/awayTeamId` | calendar entry | canonical names/ids; provider names are only used to *match* |
| `date` | `fixture.timestamp` → `YYYY-MM-DDTHH:MMZ` | |
| `state`, `statusName`, `statusDescription`, `completed` | `fixture.status.short` via `STATUS_MAP` (19 codes) | postponed = `post`/`completed:false`/`STATUS_POSTPONED` (same as ESPN snapshot); cancelled/abandoned/suspended terminal for `terminalOf()` |
| `clockStr`, `clockSec`, `period` | `status.elapsed` / `extra` | minute granularity (ESPN gives seconds); HT/BT/P use the pause label; ET period 3→4 after 105' |
| `homeScore/awayScore` | `goals.home/away` | 0 when `pre` |
| `homeWinner/awayWinner` | `teams.*.winner` | decides AET/PEN winners |
| `venue`, `city` | `fixture.venue` (fallback: calendar) | |
| `details[]` | `events[]` (Goal only) | ESPN shape `{type.text, scoringPlay, team.id, clock, athletesInvolved}`; own goals credited to the opponent (**assumption** about ESPN's convention — verify in shadow); missed penalties/cards/subs ignored |
| `statusShortDetail/Detail` | derived (`FT`, `HT`, minute, `Scheduled`) | |

Not representable: shootout score (ESPN canonical omits it too), seconds-level clock, ESPN-only `statusDetail` text for scheduled games (a localized date string).

Parity is asserted by tests: the key set of an adapter match equals `normalizeScoreboard`'s and the committed snapshot's; field types are the ones the store/hero read.

## 3. What this does NOT solve (honest list)

1. **ESPN remains the identity authority.** The calendar that supplies `id`s is the ESPN snapshot; if the ESPN pipeline stays broken or is retired, new fixtures (Copa do Brasil knockout slots still `TBD Home/Away`) get no ids. A separate calendar/identity migration would be required. Today's snapshots are *stale*: `br2026` generatedAt 2026-09-15 and `cdb2026` 2026-09-10, `stale:true`, "fetch failed: HTTP Error 400" — an unrelated finding recorded, not fixed.
2. **Team-name matching is fragile** for the 128 CDB team names (small clubs). Matching is deliberately conservative (never guess); expect `unmapped` entries until aliases/`identityMap` are filled in from a real response.
3. **Schema and header names are as publicly documented, not as verified here** (`x-apisports-key`, `fixture.status.{short,elapsed,extra}`, `league.id`, `events[].detail`). First real response must be diffed against the adapter before any cutover.
4. **Terms of use** (caching/redistribution/attribution, commercial use) UNVERIFIED — read before going to Pro.

## 4. Provider-side behaviour the design relies on (all UNVERIFIED)
`fixtures?live=71-73` returns only fixtures currently in play for both leagues in one request; update latency (~15 s claimed by third parties); `fixtures?league&season&from&to` returns scheduled/finished fixtures; errors can arrive as HTTP 200 with `errors`; rate-limit headers `x-ratelimit-requests-remaining`. Handled: 401/403/499 → AUTH, 429 → RATE_LIMITED, 5xx → UPSTREAM (never written); `errors` → NO_WRITE; empty `live` → valid, a previously-`in` match that vanishes triggers a day sync instead of an invented final.

## 5. Verdict
Coverage **UNVERIFIED** (BR and CDB). Mapping **PASS** against the documented schema with synthetic fixtures. Do not subscribe to a paid plan before the Free-tier proof in `CUTOVER_RUNBOOK.md` §A confirms league ids, season access and a real payload.
