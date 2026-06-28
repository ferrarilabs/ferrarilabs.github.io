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

---

## Admin emergency procedures

### Mark a payment manually (Supabase direct edit)

Use this if the payment checkbox in the app is unavailable or not persisting.

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Table Editor** → `bolao_state`.
2. Click the row where `id = "main"`.
3. The `state` column is a JSON object. Find the `"paid"` key:
   ```json
   "paid": {}
   ```
4. Add the entry ID with value `true`:
   ```json
   "paid": { "3f7b1a2c-4d5e-6789-abcd-ef0123456789": true }
   ```
   The entry `id` is found in the `"entries"` array in the same JSON — look for the participant's name under `"entryName"`.
5. **Save** the row. The app picks up the change on next page load or focus.

To mark multiple entries:
```json
"paid": {
  "<id-1>": true,
  "<id-2>": true
}
```

To unmark a payment (override any-true-wins): set the value to `false`. Note: the app's merge logic uses "any-true-wins", so the unmark will hold only until the next save that has `true` for that key. If you need to permanently unmark, set it to `false` and immediately reload the admin panel so the app re-saves the corrected state.

---

### Enter a real match result manually (Supabase direct edit)

Use this if the admin results panel or ESPN sync is unavailable.

1. Same path: Supabase → `bolao_state` → row `id = "main"` → `state` column.
2. Find the `"results"` key and add the match:
   ```json
   "results": {
     "73": { "goalsA": 2, "goalsB": 1, "advanceSide": "A" }
   }
   ```
   - `advanceSide`: `"A"` = teamA advances, `"B"` = teamB advances. Required for knockout scoring.
   - For group stage matches, `advanceSide` is not needed: `{ "goalsA": 1, "goalsB": 0 }`.
3. Save the row. Reload the app to verify the score appears in the Jogos tab.

---

### Delete a single entry manually (Supabase direct edit)

1. Open the `state` JSON → `"entries"` array.
2. Remove the object where `"id"` matches the entry to delete.
3. If that entry had a paid mark, also remove its key from `"paid"`.
4. Save.

---

### Full state reset (emergency)

From the admin panel: **Limpar tudo** button clears both localStorage and Supabase.
From Supabase directly: set `state` to:
```json
{"entries":[],"paid":{},"results":{},"meta":{"updatedAt":"2026-06-28T00:00:00.000Z","version":"v4.7"}}
```
Replace the `updatedAt` value with the current UTC time in ISO 8601 format.

---

### Remove or correct a wrong result (Supabase direct edit)

Use this if ESPN sync applied an incorrect score.

1. Supabase → `bolao_state` → row `id = "main"` → `state` column.
2. Find `"results"` and locate the wrong match by its numeric ID (e.g. `"73"`).
3. To **correct** it, update the values:
   ```json
   "73": { "goalsA": 1, "goalsB": 0, "advanceSide": "A" }
   ```
4. To **remove** it entirely (so the Jogos tab shows "Scheduled" again), delete that key from the `results` object.
5. Save. Reload the app to confirm.

Match IDs: group stage = `"GS-01"` through `"GS-72"`. Knockout = `"73"` through `"104"`.

---

### Add an entry manually (late submission or WhatsApp request)

Use this if a participant can't use the form (e.g. cutoff passed, mobile issue).

1. Supabase → `bolao_state` → `state` → `"entries"` array.
2. Append a new entry object. The minimum required fields:
   ```json
   {
     "id": "manual-<timestamp>",
     "entryName": "Eduardo #3",
     "payerName": "Eduardo",
     "participantEmail": "user@example.com",
     "paymentMethod": "CashApp",
     "paymentTo": "$EduardoFerrari",
     "createdAt": "2026-06-28T12:00:00.000Z",
     "picks": {}
   }
   ```
   - `picks` can be empty `{}` if you don't have the bracket data — the entry will score 0.
   - Use a unique `id` string; `"manual-<timestamp>"` is fine.
3. If already paid, also add to `"paid"`: `"manual-<timestamp>": true`.
4. Save. The entry will appear in Ranking and Participants immediately on next reload.

---

### Rename or edit an entry (Supabase direct edit)

Use this if a participant submitted with the wrong name.

1. Supabase → `bolao_state` → `state` → `"entries"` array.
2. Find the entry by `"id"` or `"entryName"`.
3. Edit the desired fields (`"entryName"`, `"payerName"`, `"participantEmail"`, etc.).
4. Do NOT change `"id"` or `"createdAt"` — these are used as stable keys in `paid` and for the receipt code.
5. Save.

---

### Reset the admin password

1. Generate a new SHA-256 hash in the browser console (any page):
   ```js
   crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourNewPassword"))
     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
   ```
2. Copy the 64-character hex string from the console.
3. In `bolao-teste/js/config.js`, replace `adminPasswordHash` with the new hash.
4. Bump `siteVersion` and push to `main`.

The old password is immediately invalidated on deploy. Any active admin sessions (in `sessionStorage`) expire within 30 minutes regardless.

---

### Read the current Supabase state without the app

To inspect what's in Supabase from the browser console on any page:

```js
const { createClient } = supabase; // only works if supabase CDN is loaded on that page
// Otherwise open the bolao app and run in its console:
(async () => {
  const raw = localStorage.getItem("bolao_copa_2026_state");
  const s = JSON.parse(raw);
  console.log("Entries:", s.entries.length);
  console.log("Paid:", Object.keys(s.paid).filter(k => s.paid[k]));
  console.log("Results:", Object.keys(s.results));
})();
```

This reads from `localStorage` (the local copy). For the authoritative Supabase copy, use the Supabase Table Editor directly.

---

### Sync a device that shows stale data

If a browser/device shows old entries or missing results after a push:

1. Open the bolão app in that browser.
2. Open DevTools console and run:
   ```js
   localStorage.removeItem("bolao_copa_2026_state");
   location.reload();
   ```
3. On reload, `init()` calls `loadRemoteState()` which pulls the latest Supabase state fresh.

Alternatively: open the app → switch tabs away and back → the `visibilitychange` handler triggers a Supabase sync automatically.

---

### Recover from corrupted localStorage (app won't load)

If the app shows a blank screen or JS errors on load:

1. Open DevTools console.
2. Run:
   ```js
   localStorage.removeItem("bolao_copa_2026_state");
   location.reload();
   ```
3. The app reloads with empty local state and immediately fetches Supabase. All entries and results are recovered from the remote copy.

No data is lost as long as Supabase is intact.

---

### Export all data without the app (Supabase direct)

If the app is broken and you need the raw data:

1. Supabase → Table Editor → `bolao_state` → row `id = "main"`.
2. Click the `state` cell to expand the full JSON.
3. Copy the entire JSON and paste into a `.json` file.

The `entries` array contains every submission with name, email, payment method, bracket picks, and receipt code. The `paid` object maps entry IDs to payment status. The `results` object has all admin-entered match scores.

---

### Rollback the app to a previous version

```bash
# Option A — revert the last commit
git revert HEAD && git push

# Option B — restore specific files from a previous commit
git checkout <commit-hash> -- bolao-teste/
git commit -m "Revert bolao to <version>"
git push
```

After rollback, the `siteVersion` in `config.js` may be stale but the app will still function. Participants may see a cached old version until their browser fetches the new `?v=` query string.

---

### ESPN sync applied results for the wrong matches

Symptom: Jogos tab shows a score for a match that hasn't happened, or the wrong score for a match that has.

Fix:
1. Remove the wrong result from Supabase (see "Remove or correct a wrong result" above).
2. If the correct score is known, enter it manually via the admin results panel or Supabase.
3. If ESPN keeps applying the same wrong match: the sync only skips matches where `state.results[matchId].goalsA` is already set. Once you set the correct result manually, ESPN sync will no longer overwrite it.

Root cause note: ESPN sync matches events by team name + date. If two different tournaments had the same teams play on the same date, a false match is possible. Date is checked as ET timezone (UTC−4).
