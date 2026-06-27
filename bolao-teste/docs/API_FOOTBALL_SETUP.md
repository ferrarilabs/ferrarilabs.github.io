# API-Football / API-SPORTS Setup

The site now has an optional API-Football refresh button in Admin.

API-SPORTS documents the World Cup as `league=1` and `season=2026`; their `/fixtures?league=1&season=2026` endpoint returns schedule, fixture id, UTC date/time, venue and status. The guide also documents standings, predictions and odds endpoints.

## Important security note

Putting an API-Football key in a browser-visible static site exposes that key to visitors. For a real production setup, use a small backend or Supabase Edge Function as a proxy.

For testing only, edit `js/config.js`:

```js
apiFootball: {
  enabled: true,
  apiKey: "YOUR_API_FOOTBALL_KEY",
  baseUrl: "https://v3.football.api-sports.io",
  league: 1,
  season: 2026,
  cacheMinutes: 60
}
```

Then deploy and use Admin → Atualizar jogos/API.

Current behavior:
- the API response is cached in localStorage as `bolao_api_football_fixtures`;
- it does not overwrite the bracket automatically yet;
- this avoids breaking the validated bracket data structure right before production.
