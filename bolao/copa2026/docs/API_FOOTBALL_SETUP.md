# API-Football Setup & Live Results Polling

## Overview

The Bolão app supports optional live result fetching from [API-Football (api-sports.io)](https://www.api-football.com/). When enabled, the app polls for finished match scores every 5 minutes while the admin is logged in and the browser tab is visible. Results are applied automatically to the bracket — without overwriting anything the admin has entered manually.

---

## Security warning — API key in browser code

**API keys placed in a static browser app are public.** Any visitor who opens the browser console or views source can read the key. Do NOT use a paid plan key in a high-traffic public site without a backend proxy.

**Recommended for production:** create a [Supabase Edge Function](https://supabase.com/docs/guides/functions) as a proxy. The function holds the key as an environment secret and returns only the filtered fixture data. The browser calls the Edge Function URL instead of API-Sports directly.

---

## Setup

### 1. Get a free API key

Sign up at https://dashboard.api-football.com/register. The free tier allows 100 requests/day.

### 2. Edit `js/config.js`

```js
apiFootball: {
  enabled: true,
  apiKey: "YOUR_API_KEY_HERE",
  baseUrl: "https://v3.football.api-sports.io",
  league: 1,        // FIFA World Cup
  season: 2026,
  cacheMinutes: 60
}
```

### 3. Deploy

Push to `main`. GitHub Pages will redeploy automatically.

---

## How polling works

| Condition | Behaviour |
|---|---|
| `enabled: false` or `apiKey: ""` | No requests made; button does nothing |
| Admin logged in, tab visible | Polling starts; interval = 5 minutes |
| Tab hidden (`visibilitychange`) | Polling paused immediately |
| Tab returns to focus | Polling resumes (if admin still active) |
| Admin logs out | Polling stops |
| Page reloaded with valid admin session | Polling auto-resumes |

The status bar below the admin toolbar shows:
- **Source:** API-Football
- **Last update:** HH:MM
- **Auto-update:** on / off

---

## What gets applied automatically

Only finished matches (`status.short` = `FT`, `AET`, or `PEN`) are considered.

For each finished fixture the API returns, the app:
1. Normalizes team names and matches by date to find the corresponding bracket entry.
2. Skips slots still showing placeholders ("Winner Match X", "1st Group H", etc.) — those cannot be reliably matched.
3. Skips any match that already has a manually entered result — **manual results are never overwritten**.
4. For non-draw results: sets `goalsA`, `goalsB`, and `advanceSide` automatically.
5. For draw results: sets goals only — admin must choose who advances via the results panel.

Results are saved to `localStorage` and synced to Supabase (if enabled).

---

## How to disable

Set `enabled: false` in `config.js` and redeploy. No restart needed — the condition is checked at runtime on every action.

---

## Validation

After enabling, open Admin → you should see the status bar appear after the first poll (≤5 minutes). To verify data landed in `localStorage`:

```js
// In browser console:
JSON.parse(localStorage.getItem("bolao_api_football_cache")).ts
// → Unix timestamp of last fetch

JSON.parse(localStorage.getItem("bolao_copa_2026_state")).results
// → Object with matchId → { goalsA, goalsB, advanceSide }
```

To validate what reached Supabase, run in the SQL Editor:
```sql
select state->'results' from bolao_state where id = 'main';
```

---

## Manual refresh button

The **"Atualizar resultados agora"** button in the admin toolbar triggers an immediate fetch + apply cycle (same logic as the polling interval, just on demand).

The separate **"API-Football"** button (existing, `#refreshFootballApi`) fetches and caches the raw payload only — it does not apply results to the bracket. Use it to inspect the raw API response in `localStorage["bolao_api_football_cache"]`.

---

## Limitations

- Team name matching is fuzzy (normalization + date). Name mismatches between API-Football and `data.js` will cause skipped matches — check `console.warn` output.
- Clock manipulation on client can affect polling timing (non-issue in practice).
- API-Football free tier: 100 req/day. Each poll = 1 request. 5-min polling = max 12 req/hour (rarely hits limit in practice since polling only runs while admin tab is open).
- Draws in knockout rounds require manual winner selection — the API cannot determine who won the penalty shootout from goal data alone.
