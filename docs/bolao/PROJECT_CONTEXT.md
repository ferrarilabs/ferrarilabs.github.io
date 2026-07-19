# Project Context — Bolão do Ferrari

## Product vision

A Copa do Mundo 2026 bracket pool ("bolão") for Eduardo Ferrari's friends and family.
Participants predict knockout-round scores before the deadline, earn points as matches resolve, and compete on a public ranking.
Everything runs in the browser — no server, no login, no database required to function.

## Access

- **URL:** `https://ferrarilabs.github.io/bolao-teste/`
- **Admin contact:** emferrari@gmail.com (Eduardo Ferrari)
- **WhatsApp group:** linked from the payment section and header support button

## Tournament

- **Competition:** FIFA World Cup 2026
- **Host:** USA / Canada / Mexico
- **Group stage:** 72 matches, 12 groups (A–L), 4 teams per group
- **Knockout stage:** 32 matches (Round of 32 → Round of 16 → Quarters → Semis → 3rd Place → Final)
- **Final:** Match 104, July 19 2026, MetLife Stadium, East Rutherford NJ
- **Picks cutoff:** Sunday June 28 2026 at 2:00 PM ET (1 hour before the first Round of 32 match)

## Entry rules

- **Fee:** US$ 5 per entry, unlimited entries per person
- **Payment methods:** CashApp ($EduardoFerrari), Zelle (914-406-5027), Venmo (Eduardo-Ferrari)
- **Prize pool:** 70% → 1st, 20% → 2nd, 10% → 3rd
- **Deadline enforcement:** client-side; form and save button are disabled past `cutoffIso`
- **Informal:** no legal liability; dispute resolution is at Eduardo's discretion

## Scoring

All points are awarded only for knockout matches (73–104). Group stage results are displayed for context but are not scored.

| Event | Points |
|---|---|
| Exact score (90 min + ET) | 10 |
| Correct team advancing | 5 |
| One team's goals correct | 1 |
| **Bonus: champion** | +25 |
| **Bonus: runner-up** | +15 |
| **Bonus: 3rd place** | +10 |
| **Bonus: 4th place** | +5 |

Penalty shootout results do not affect the score — only goals in 90 min + extra time count.
On a draw, the participant selects who advances (the "advanceSide" field).

## Version history summary

| Version | Date | Summary |
|---|---|---|
| v3.0 | 2025 | First stable version. CSV, receipts, admin, ranking, i18n, EmailJS |
| v3.2.1 | 2025 | Release-lock patch, UK flag fix, score guard, i18n receipt labels |
| v3.3-db-ready | 2025 | Supabase optional remote state |
| v3.3.1 | 2025 | Desktop/mobile header, flag language buttons, games view redesign |
| v3.3.4 | 2025 | Language dropdown removed, timer seconds, Supabase focus/visibility reload |
| **v4.0-clean** | **2026-06-27** | **Full clean rebuild. No code carried from v3.x.** |

<!-- AUTO:PLATFORM_CONTEXT:START -->
## Platform context (three apps)

This product vision document describes **Copa do Mundo 2026** (`bolao/`) specifically. It is
one of three bolão apps in this repo:

| App | Pasta | Status |
|---|---|---|
| Copa do Mundo 2026 | `bolao/` | Em produção |
| Brasileirão 2026 | `bolao/br2026/` | Não publicado |
| Copa do Brasil 2026 | `bolao/cdb2026/` | Publicado 2026-07-19, em produção |

The three apps share the same design system, admin auth pattern, EmailJS/Supabase
integration style, and general product shape (entry → picks → ranking → admin), but each has
its own scoring formula and bracket/table structure appropriate to its tournament format.
Product-vision decisions made here (pricing, prize split, informal/no-liability framing)
apply as defaults to the other two apps unless their own `CHANGELOG.md` documents a deliberate
difference. See `docs/bolao/PLATFORM_GOVERNANCE.md` for the propagation rules and
`docs/bolao/CONSISTENCY_MATRIX.md` for the current area-by-area comparison.
<!-- AUTO:PLATFORM_CONTEXT:END -->
