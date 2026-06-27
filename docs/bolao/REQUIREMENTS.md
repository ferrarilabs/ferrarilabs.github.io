# Requirements — Bolão do Ferrari

These are the requirements as implemented in v4.0-clean. Nothing here is speculative.

## Participant flow

1. **Fill bracket** — 32 knockout matches (73–104). For each match:
   - Enter goals for Team A and Team B (integer 0–20).
   - Select who advances (auto-filled when there is a clear winner by score; required on draws).
2. **Fill entry details** — entry name, payer name, email, payment method.
3. **Submit** — validation runs; on success the entry is saved to localStorage (and Supabase if configured).
4. **Receipt** — a `BOLAO-XXXXXXXX-YYYYMMDD` code is displayed. Three receipt actions:
   - Open receipt (Blob URL popup → print/save as PDF)
   - Download HTML file
   - Send to participant email via EmailJS
5. **Draft restore** — if the user refreshes mid-fill, they are offered to restore picks (sessionStorage, 2-hour expiry).

## Validation rules (enforced before save)

- Entry name, payer name, payment method: required, non-empty.
- Email: valid format (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`), no spaces.
- All 32 knockout matches must have both goals filled.
- Goals: integer 0–20; values outside range are rejected.
- On a draw: advance side must be explicitly selected.
- Score winner must match advance side (if score is not a draw).
- Scores ≥10 goals or difference ≥8: user confirmation required.
- More than 8 matches with identical score: repetition warning.

## Ranking & scoring

- Ranking is computed live from `localStorage` state on every render.
- `scoreEntry(entry, state)` is called once per entry per render.
- Points accumulate as admin enters real results for each match.
- Bonus points are computed from `finalPodiumForEntry` vs `podiumFromResults`.
- Display: sorted descending; medals 🥇🥈🥉 for top 3; expandable picks table.

## Admin features

- **Login:** SHA-256 password hash comparison via `crypto.subtle`.
- **Session:** 30 minutes, stored in `sessionStorage`; cleared on tab close.
- **Lockout:** 5 failed attempts → 15-minute lockout via `localStorage`.
- **`guardAdmin()`:** called on every admin action, not just on section load.
- **Payment tracking:** checkbox per entry → `state.paid[id]` → synced to Supabase.
- **Real results:** enter actual goals + advance side for each match → ranking updates live.
- **Delete entry:** confirm → optional reason → removes from state → sends removal email.
- **Receipts:** open, download HTML, email participant, email admin.
- **Demo data:** creates 3 demo entries (Ana/Bruno/Carlos Demo) for testing.
- **Clear all data:** wipes localStorage + Supabase remote.
- **Exports:**
  - Master CSV (summary: id, code, name, payer, email, method, paid, score)
  - Backup CSV (full: all of above + all 32 match picks inline)
  - Backup JSON (full state object)
  - Master HTML (styled table for printing)
- **API-Football refresh:** fetches fixtures from `v3.football.api-sports.io`, caches to `bolao_api_football_cache` in localStorage. Does **not** auto-update `data.js` bracket.

## Games section

- Displays all 72 group-stage matches + 32 knockout matches.
- Shows date, time ET, venue, group, status (Final / Scheduled), and score.
- Status chip: green "Finalizado" / yellow "A jogar".

## Payment section

- Lists CashApp, Zelle, Venmo with handle/number and payment links.
- Zelle shows QR image (`assets/zelle-qr.png`).
- WhatsApp group link and QR available in payment section.

## Language support

Three languages, toggled via flag buttons in the header. Persisted in `localStorage` key `bolao_lang`.

| Code | Button | Locale |
|---|---|---|
| `pt-BR` | 🇧🇷 PT-BR | Portuguese (Brazil) — default |
| `es` | 🇲🇽 ES-MX | Spanish (Mexico) |
| `en-US` | 🇺🇸 EN-US | English (US) |

All UI strings are in `js/i18n.js`. Phase labels, receipt labels, rules, and all alerts are translated.

## Simulator

- **Smart (⚡):** uses `DATA.strength` ratings; logistic function for win probability; produces scores like 2–1, 3–1, 1–2, 1–3.
- **Random (🎲):** uniform random 0–4 goals each side.
- Both simulators propagate bracket slots correctly across rounds.
- Disabled after cutoff; warns before overwriting existing picks.

## Static site constraints

- No server-side auth — admin security is best-effort client-side.
- Cutoff enforcement is client-side only (clock manipulation bypasses it).
- EmailJS public key is visible in source — this is unavoidable for a browser-only app.
- API-Football key would be visible in source if set — recommended to use a proxy for production.
- Supabase anon key is visible in source — acceptable because RLS limits operations to `id = 'main'`.
- No server-side rendering; all state is rebuilt from `localStorage` on every page load.

## Polymarket integration

- Reads public prediction market probabilities from `gamma-api.polymarket.com`.
- `externalData.polymarket.enabled: true` in config.
- Used by the smart simulator to weight pick probabilities when odds are available.
- Not currently wired to a separate UI indicator — it influences `autoFill("smart")` internally.
- Disclaimer shown in rules: probabilities are informational and not betting recommendations.
