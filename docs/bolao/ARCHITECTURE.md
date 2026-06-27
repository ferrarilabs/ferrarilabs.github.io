# Architecture — Bolão do Ferrari

## Stack

- **Runtime:** static HTML served from GitHub Pages — no server, no build step, no framework.
- **JS:** plain ES5-compatible code in a single IIFE (`app.js`). No modules, no bundler.
- **CSS:** single file `css/styles.css`. Mobile-first, responsive. Inline styles are blocked by CSP.
- **Persistence:** `localStorage` (primary) + Supabase (optional remote mirror).
- **Email:** EmailJS (browser SDK, CDN).
- **External data:** Supabase REST API, API-Football REST API, Polymarket Gamma API.

## File structure

```
bolao-teste/
├── index.html           # Single page; all sections are hidden/shown by JS
├── css/styles.css       # All styles
├── js/
│   ├── config.js        # window.BOLAO_CONFIG  — all runtime config
│   ├── data.js          # window.BOLAO_DATA    — fixtures, flags, strength ratings
│   ├── i18n.js          # window.BOLAO_I18N    — all UI strings (3 languages)
│   ├── i18n-repair.js   # (legacy, not loaded in v4.0; kept for reference)
│   └── app.js           # Main IIFE — all logic
├── assets/
│   ├── cashapp.svg / paypal.svg / venmo.svg / whatsapp.svg / zelle.svg
│   ├── whatsapp-group-qr.png
│   └── zelle-qr.png
└── docs/                # Setup and reference docs (not served as app pages)
```

## Script load order (index.html `<head>`)

1. `cdn.jsdelivr.net` — `@emailjs/browser@4` (sync)
2. `cdn.jsdelivr.net` — `@supabase/supabase-js@2` (sync)
3. `js/config.js` — assigns `window.BOLAO_CONFIG` (sync)
4. `js/data.js` — assigns `window.BOLAO_DATA` (sync)
5. `js/i18n.js` — assigns `window.BOLAO_I18N` (sync)
6. `js/app.js` — `defer`; executes after DOM is ready

`app.js` verifies all three globals exist at startup; renders an error message if any is missing.

## State shape (localStorage key: `bolao_copa_2026_state`)

```json
{
  "entries": [
    {
      "id": "<uuid>",
      "entryName": "Eduardo #1",
      "payerName": "Eduardo",
      "participantEmail": "user@example.com",
      "paymentMethod": "CashApp",
      "paymentTo": "$EduardoFerrari",
      "createdAt": "2026-06-27T20:00:00.000Z",
      "diagnostics": { "userAgent": "...", "timezone": "...", "viewport": "...", "capturedAt": "..." },
      "picks": {
        "73": { "goalsA": 2, "goalsB": 1, "advanceSide": "A", "displayA": "South Africa", "displayB": "Canada" }
      }
    }
  ],
  "paid": { "<entry-id>": true },
  "results": {
    "73": { "goalsA": 1, "goalsB": 0, "advanceSide": "A" }
  },
  "meta": { "updatedAt": "2026-06-27T20:00:00.000Z", "version": "v4.0-clean" }
}
```

## Supabase schema

Single table `public.bolao_state`:

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PRIMARY KEY | Always `"main"` for this app |
| `state` | `jsonb` | Full state object, max 1 MB |
| `updated_at` | `timestamptz` | Set on every upsert |

RLS: anon role can read/insert/update only `id = 'main'`. Service role key is never used.

## Merge strategy (merge-before-save)

On every remote save:
1. Fetch remote `updated_at` and `state`.
2. If remote `updated_at` > local `meta.updatedAt`: merge first, then save.
3. Merge rules:
   - `entries`: union by `id`; newest `createdAt` wins on conflict.
   - `paid`: `Object.assign({}, remote.paid, local.paid)` — local wins per key.
   - `results`: `Object.assign({}, remote.results, local.results)` — local wins per key.

Local-first: Supabase failure silently falls back to localStorage only.

## Draft persistence

- Key: `sessionStorage["bolao_draft_v4"]`
- Shape: `{ picks: {matchId: {goalsA, goalsB, advanceSide}}, name, payer, email, method, ts }`
- Expiry: 2 hours from `ts`. Silently discarded if older.
- Cleared: after successful save or explicit user rejection.

## Receipt code format

```
BOLAO-{8-char hex hash of (entryName + createdAt)}-{YYYYMMDD of createdAt}
```

Hash: FNV-32 (`hashString()`) — deterministic, not cryptographic. Used for identification only.

## Key functions in app.js

| Function | Purpose |
|---|---|
| `state()` | Read localStorage, return parsed state or emptyState() |
| `saveState(s)` | Write localStorage + debounce Supabase upsert (400ms) |
| `mergeStates(local, remote)` | Union entries, local-wins for paid/results |
| `loadRemoteState()` | Fetch Supabase, merge, save locally |
| `saveRemoteState(s)` | Merge-before-save, upsert to Supabase |
| `scoreEntry(entry, state)` | Compute total + bonus for one entry |
| `finalPodiumForEntry(entry)` | Resolve champion/runner-up/3rd/4th from entry picks |
| `podiumFromResults(state)` | Same from real results |
| `resolvedTeamsForEntry(entry)` | Walk bracket, resolving "Winner Match N" slots |
| `receiptHtml(entry)` | Generate self-contained receipt HTML string |
| `openReceipt(id)` | Blob URL popup |
| `downloadReceipt(id)` | Blob download |
| `mailReceipt(id, target)` | EmailJS send (participant or admin) |
| `autoFill(mode)` | Simulator: "smart" or "random" |
| `guardAdmin()` | Verify session is active; redirect to login if not |
| `adminLogin()` | SHA-256 hash comparison, lockout management |
| `renderAll()` | Full re-render of all sections |
| `renderBracket()` | Build bracket form DOM from DATA.knockoutMatches |
| `updateDynamic()` | Re-resolve bracket slot names after any score input |
| `inferFromForm()` | Read current form state to propagate bracket winners |

## i18n implementation

- `currentLang`: module-level variable; persisted to `localStorage["bolao_lang"]`.
- `t(key)`: look up in `I18N[currentLang]`, fall back to `I18N["pt-BR"]`, then return key.
- `applyLanguage()`: walks all `[data-i18n]` elements and sets `textContent`.
- `setLang(code)`: sets `currentLang`, persists, calls `applyLanguage()` + `renderAll()`.
- All rendered HTML uses `escapeHtml()` + `t()` — no raw user strings in innerHTML.

## Event handling

Single `document.addEventListener("click", ...)` and `document.addEventListener("change", ...)` handle all interactions via `e.target.closest(selector)` delegation. No inline `onclick` handlers.

## Countdown timer

`setInterval(updateCountdown, 1000)` — updates the hero countdown every second.
Reads `CONFIG.cutoffIso` → `new Date(CONFIG.cutoffIso)`.

## API-Football cache

Key: `localStorage["bolao_api_football_cache"]`
Shape: `{ ts: Date.now(), payload: <API response> }`
Cache TTL: `CONFIG.apiFootball.cacheMinutes` (default 60).
Does **not** auto-update `DATA.knockoutMatches` — admin must manually reconcile if needed.

## Polymarket

Fetches from `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100`.
Used internally to bias smart simulator probabilities when matching events are found.
No UI widget; purely internal to `autoFill("smart")`.
