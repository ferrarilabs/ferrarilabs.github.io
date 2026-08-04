# Template: Adicionar Nova Loteria ao Powerball Pool

## Arquitetura Reutilizável

O Powerball pool foi construído com uma arquitetura escalável para suportar múltiplas loterias (Powerball, Mega Millions, Super Lotto, etc). Qualquer nova loteria segue o mesmo padrão.

## Passos para Adicionar Nova Loteria

### 1. Adicionar Game Type em `js/data.js`

```javascript
window.LOTTERY_GAME_TYPES = {
  powerball: { /* ... */ },
  megamillions: { /* ... */ },
  // NEW LOTTERY HERE:
  supalotto: {
    label: "Super Lotto",
    icon: "🟠",  // unique emoji
    specialBallLabel: "Megaball",  // or whatever the game calls it
    accent: "#FF6B35",  // primary brand color
    accent2: "#004E89",  // secondary brand color
    previousResultsUrl: "https://lottery.example.com/results",
    resultsApi: "https://api.example.com/resource/results.json",
    parseResult: function (row) {
      // Parse the API response for this specific lottery
      // Must return: { numbers: [n1, n2, n3, n4, n5], special: N, multiplier: M }
      var parts = row.winning_numbers.trim().split(/\s+/).map(Number);
      return { 
        numbers: parts.slice(0, 5), 
        special: parts[5], 
        multiplier: Number(row.multiplier) || 1 
      };
    },
    prizeTable: function (mainMatches, specialMatch, multiplier) {
      // Define payout rules for this lottery
      // Returns: { label: "description", amount: USD } or null
      if (mainMatches === 5 && specialMatch) return { label: "JACKPOT", amount: null };
      if (mainMatches === 5) return { label: "5 acertos", amount: 1500000 };
      // ... add all prize tiers
      return null;
    }
  }
};
```

### 2. Add EmailJS Config in `js/config.js`

No changes needed — EmailJS uses the same templates for all lotteries.

### 3. Add Draw to `js/data.js`

```javascript
window.POWERBALL_DRAWS = [
  { /* powerball draw */ },
  { /* megamillions draw */ },
  // NEW LOTTERY DRAW:
  {
    id: "2026-09-15",
    gameType: "supalotto",  // must match LOTTERY_GAME_TYPES key
    drawing: {
      name: "Super Lotto Jackpot",
      jackpot: 500000000,
      drawDateIso: "2026-09-15T19:00:00-05:00",
      drawDateLabel: "15/09/2026 19:00 ET"
    },
    participants: [
      // ... all 14 participants with emails already filled
    ],
    sharedTickets: {
      compradoPor: "—",
      dataComprovante: "—",
      valorPorTicket: 2,  // varies by lottery
      series: []
    },
    finance: {
      totalArrecadado: 0,
      valorUtilizado: 0,
      valorGuardadoProximoSorteio: 0
    },
    result: {
      numbers: null,
      special: null,
      multiplier: null,
      checkedAt: null
    },
    profit: {
      premiosGanhos: null,
      lucro: null
    }
  }
];
```

### 4. Update CSP in `index.html` (if new API domain)

```html
<meta http-equiv="Content-Security-Policy" content="
  connect-src 'self' https://data.ny.gov https://api.newlottery.com;
  ...
">
```

### 5. Test

1. Visit `ferrarilabs.github.io/bolao/loterias/supalotto/` (or appropriate URL)
2. Wait for draw time
3. Verify automatic result fetch from API
4. Verify emails sent to all 14 participants
5. Verify prize calculation

## What's Automatic (No Code Changes)

✅ Result fetching from official API
✅ Prize calculation using game-specific table
✅ Email dispatch to all participants
✅ Result display with breakdown
✅ Theme switching (colors, labels, icons)
✅ Participant email addresses (pre-filled from prior draw)
✅ Finance tracking (carryover from previous draw)

## Files That Don't Change

- `js/app.js` — all logic is game-agnostic
- `js/config.js` — EmailJS config is shared
- `index.html` — CSP update only if needed
- `css/styles.css` — colors set dynamically from LOTTERY_GAME_TYPES
- All render functions — work with any game type

## One-Time Setup per Lottery

1. Define `LOTTERY_GAME_TYPES[gameType]` with icon, colors, API endpoint, parse function, prize table
2. Add first draw to `POWERBALL_DRAWS` array with `gameType` reference
3. Update CSP if new API domain
4. Add participants with emails (copy from prior lottery)

**Everything else flows automatically.**

## Validation Checklist

- [ ] API endpoint returns valid results for past draws
- [ ] Parse function correctly extracts numbers + special ball + multiplier
- [ ] Prize table covers all winning combinations
- [ ] Colors are readable in light/dark theme
- [ ] Email dispatch works (check console logs)
- [ ] All 14 participants have valid emails in draw object
- [ ] Scoring audit passes: `python3 bolao/loterias/<gameType>/scripts/audit_scoring.py`

## Support for Multiple Games in One Pool

You can mix lottery types in one draw (though uncommon):

```javascript
// If Powerball and Mega Millions split the same pool:
{
  id: "2026-10-01",
  gameType: "powerball",  // or "megamillions"
  // ... rest of draw
}
```

The app automatically switches UI colors/labels/icons based on `gameType`.

---

**Pattern validated with:** Powerball, Mega Millions, Powerball 05/08/2026 template
