# v3.2 Surgical Fixes

Minimal patch on top of v3.1. No structural rewrite.

## Fixed
- `winnerLabel()` now uses i18n:
  - PT-BR: Quem ganha? / Quem avança?
  - ES: ¿Quién gana? / ¿Quién avanza?
  - EN: Who wins? / Who advances?
- Ranking bonus label now uses i18n instead of hardcoded "bônus".
- Bracket dropdown options update from generic Time A/Time B to the resolved team names.
- Added broader flag coverage, including South Africa.
- Patched visible Match 73 and Match 74 venue/time data from current public schedule references.
- Added immediate guard for score inputs greater than 20.

## Not changed
- No rewrite of app architecture.
- No backend/security model change.
- Remaining schedule/results updates should be treated as data updates, not code rewrites.
