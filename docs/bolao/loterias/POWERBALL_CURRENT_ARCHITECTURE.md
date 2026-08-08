# Powerball — Current Architecture (as of `origin/main`, 2026-08-04)

This document describes what actually exists in `bolao/loterias/powerball/` today, confirmed by
reading the code — not what the folder name or comments imply. Where a capability is documented
somewhere (a `docs/` file, a code comment) but not wired up in the running app, that gap is called
out explicitly.

## Inventory

```
bolao/loterias/powerball/
├── index.html            single page, no framework, no build step
├── js/
│   ├── config.js         EmailJS config + (referenced but MISSING) admin password hash
│   ├── data.js            source of truth for everything: draws, participants, payments,
│   │                       tickets, results — a hand-edited JS array, committed to git
│   └── app.js             ~560 lines, one IIFE: render, finance calc, result fetch, email send,
│                           admin login gate
├── css/styles.css
├── sw.js                  service worker, network-first passthrough (no caching)
├── .htaccess
├── docs/DATABASE_SETUP_SUPABASE.md   setup instructions for a Supabase table THAT IS NOT USED
│                                       anywhere in js/app.js or js/config.js — aspirational docs,
│                                       not current architecture
└── scripts/
    ├── add_participants.py   CLI, edits data.js directly (git-committed, not run at request time)
    ├── add-participant.js    same, Node version
    ├── audit_scoring.py      NOT prize-scoring audit — validates LOTTERY_GAME_TYPES.prizeTable
    │                          structural shape only (see incident review)
    └── new_participants_template.csv
```

`.github/workflows/` — **zero** workflows reference `powerball` or `loterias`. Confirmed via
`ls .github/workflows/ | grep -i powerball` → empty. Every other bolão app (copa2026, br2026,
cdb2026) has at least one scheduled workflow; Powerball has none.

`supabase/` — no such directory in this repo. The `DATABASE_SETUP_SUPABASE.md` under
`bolao/loterias/powerball/docs/` describes a schema that was never implemented against.

## Origin of each concept

| Concept | Where it lives | How it gets there |
|---|---|---|
| Participants | `js/data.js` `draws[i].participants[]` | Hand-typed, or `add_participants.py`/`add-participant.js` run locally by whoever has repo write access, then committed to git |
| Payments | Same array, `valor`/`metodo`/`txId`/`data`/`hora` fields on each participant | Same as above — no separate payments table/record; a payment **is** a participant row |
| Tickets | `js/data.js` `draws[i].sharedTickets.series[]` | Hand-typed after Eduardo buys tickets and reports the ticket serials back |
| Draws | `js/data.js` `window.POWERBALL_DRAWS` array | New object appended by hand for each new draw |
| Results | `draws[i].result` in `data.js` (server-declared placeholder, usually `null`) **and** `localStorage["powerball_local_results_v1"]` (browser-side override, see `getEffectiveDraw()` in app.js:67-74) | Fetched live from NY Open Data (`fetchOfficialResult()`, app.js:218-227) by whichever browser happens to load the page after the draw; saved to that browser's `localStorage` only — **never written back to `data.js` or any shared store** |
| Admin writes | Nowhere. `pbAdminLink` click handler references DOM elements (`pbAdminLoginModal`, `pbAdminPanel`, `pbAdminPasswordInput`, etc.) that **do not exist in `index.html`** — confirmed via `grep -n "pbAdmin" index.html`, only `pbAdminLink` itself is present. The admin password check also compares against `POWERBALL_CONFIG.adminPasswordHash`, a field that **does not exist in `config.js`** — the comparison is `hash === undefined`, always false. There is no working admin UI and no way to authenticate into one. |

## Email

- **Provider**: EmailJS (client-side JS SDK, `@emailjs/browser@4` from a CDN `<script>` tag), same
  service/keys the other three bolão apps share (`config.js`: `service_o4hyzxr`,
  `template_xq7yzzb` participant, `template_4sgp5r9` admin).
- **Who triggers it**: `sendResultEmail()` (app.js:263-306), called from exactly one place —
  inside the `.then()` of `fetchOfficialResult()` (app.js:346-364), which itself only runs inside
  `renderDraw()` (app.js:429+), which only runs on `DOMContentLoaded` or when the draw selector
  changes. **There is no server-side trigger of any kind.** "Automatic" in this codebase means:
  a browser has to load the page, after the draw has occurred, for the app to even attempt
  fetching the result and sending email. If nobody opens the page, nothing happens — ever.
- **Recipient selection**: every entry in `draw.participants[]` with a string containing `@`
  (app.js:276-280) — no suppression list, no unsubscribe handling, no dedup against
  already-sent state (see Email Reliability doc for the concrete duplicate-send risk this
  creates).
- **Template**: one template body (`template_xq7yzzb`) receiving a single `html_message` field
  built entirely client-side by `buildResultEmailHtml()` (app.js:227-252) — the template itself
  has no game-specific logic, all content decisions happen in `app.js`.

## localStorage as a second, divergent source of truth

`getEffectiveDraw()` (app.js:67-74) merges `draw.result`/`draw.profit` from `data.js` with
whatever is saved under `localStorage["powerball_local_results_v1"]` **for that specific browser**.
Two people opening the admin-less page on two different computers after the same draw can each
independently fetch the official result, independently compute prizes, and independently trigger
`sendResultEmail()` — nothing coordinates between them. This is the direct mechanism behind
Incident #1/#2 in `POWERBALL_INCIDENT_REVIEW.md`.

## Diagram

```
NY Open Data (data.ny.gov)                    EmailJS (api.emailjs.com)
        │  fetch() on page load only                  ▲
        ▼                                              │ emailjs.send() — client-side,
fetchOfficialResult()                                  │ no server in the loop
        │                                               │
        ▼                                               │
computePrize()  ──────────────►  sendResultEmail() ─────┘
        │
        ▼
localStorage["powerball_local_results_v1"]   (per-browser, not shared)
        ▲
        │  read-merge on next render, this browser only
        │
data.js (git-committed, read at page load, hand-edited for participants/tickets/draws)
        ▲
        │  git commit, by a human with repo write access
        │
add_participants.py / add-participant.js / hand edits    (Admin UI: non-functional, see above)
```

No queue, no outbox, no idempotency key, no persisted audit log, no database. The entire system's
state is: one committed JS file (shared, canonical but requires a git push to change) plus
per-browser `localStorage` (private, divergent, invisible to anyone else).
