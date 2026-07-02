# Bolão Brasileirão 2026 — CHANGELOG

## v1.3 — 2026-07-02

### New features
- **Probabilidades tab**: new nav section with Poisson + Monte Carlo (2 000 simulations) championship probability table — P(G4) / P(Sul-Am.) / P(Rebaixado) per team, sorted by G4 probability, with color-coded mini bars and a Recalcular button
- **In-play probability bars**: when a match is live the card now shows animated win/draw/loss probability bars computed from in-play Poisson adjusted for time remaining and current scoreline
- **Per-match probability hints**: upcoming (pre) games in the Jogos section now show "Casa X% · Emp Y% · Fora Z%" hint lines derived from the same Poisson model
- **Poisson model**: `buildRatings()` / `expectedGoals()` / `matchProb()` / `inPlayProb()` / `runMonteCarlo()` — all pure vanilla JS, no external libraries
- **fetchStandings() extended**: now also parses `gamesPlayed`, `pointsFor`, `pointsAgainst` from ESPN stats array (needed for attack/defence ratings)
- **Match prob cache**: `_matchProbs` object caches per-fixture win/draw/loss probs; cleared on each standings poll so ratings stay fresh

## v1.2 — 2026-07-02

### Bug fixes (post mega-audit)
- **fix(timezone)**: remove `toBRT()` manual UTC-3 offset arithmetic; replace with `{ timeZone: "America/Sao_Paulo" }` in all `toLocale*` calls — was showing wrong times for users outside Brazil
- **fix(tiebreaker)**: `renderRanking()` now uses officially locked G4/Z4 results for tiebreakers when `results.locked === true`, instead of live ESPN standings that may differ
- **fix(live-overlay)**: `pollAll()` now updates ALL scoreboard matches (including post-game) in `_schedule` cache, preventing finished games from staying "Ao vivo" until TTL expires
- **fix(admin-validation)**: `saveResultsBtn` now validates SA6 ↔ G4 and SA6 ↔ Z4 overlap, preventing double-scoring for a team appearing in two zones
- **fix(emailjs-throttle)**: `sendReceipt()` now honours `C.emailjs.limitRateMs` (30s) via sessionStorage — the config value was defined but never enforced
- **fix(cache-key)**: schedule sessionStorage key is now versioned (`br2026_schedule_v1.2`) to prevent stale schema reads after version bumps
- **fix(a11y)**: removed `aria-live="polite"` from countdown div — was causing screen readers to announce every second tick

## v1.1 — 2026-07-02

### New features
- **Sul-Americana picks**: 6 team dropdowns (positions 7–12), 8 pts per correct pick — mutual exclusion with G4/Z4
- **Jogos calendar**: full 382-game Brasileirão schedule from ESPN, grouped by BRT date with venue/city; live games overlay real-time scores
- **Next game card**: countdown to next scheduled game with venue; shows live score if a match is in progress
- **Tiebreakers**: SA6 hits → G4 exact positions → Z4 exact positions
- **Standings SA zone**: rows 7–12 highlighted in amber with SA badge
- **Language**: removed es and en-US — BR2026 is pt-BR only
- **Admin results**: 3-column grid (G4 / Sul-Am. / Z4), ESPN auto-fill covers all zones
- **Rules**: updated scoring table (max 176 pts) with tiebreaker list

## v1.0 — 2026-07-02

### Initial release
- G4 (top 4, in order) + Z4 (bottom 4, in order) picks
- 8 dropdowns with mutual-exclusion validation (no team can appear twice or in both G4/Z4)
- Provisional scoring from live ESPN standings throughout the season
- Standings card with ESPN Brasileirão (bra.1) live table — polls every 60s
- Live match card when a Brasileirão match is in progress
- Admin: lock official result at season end, or fill from current ESPN standings
- Admin: payment tracking, entry edit/delete, CSV export
- Email receipt on save (EmailJS, same templates as Copa bolão)
- 3-language support: pt-BR, es, en-US
- Supabase integration ready (set `database.enabled: true` after creating row `id='br2026'`)
- Not published yet (no link from main site)
