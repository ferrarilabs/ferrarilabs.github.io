# Canonical Visual Component Catalog — Copa do Mundo 2026

Phase 1 of the platform visual-framework migration (see `CLAUDE.md`, "Golden master rule" and
"Copa do Mundo 2026 archive"). This document captures the **real, as-shipped** visual values from
`bolao/copa2026/css/styles.css` (1302 lines, the only CSS file in the app — no other stylesheet
exists in `bolao/copa2026/`) and `bolao/copa2026/index.html`. Nothing here is invented: every
value is a direct read of the current source. Where a requested component does not exist as a
distinct rule in Copa's actual code, that is stated explicitly instead of fabricating one.

Source commit: `d04b2ca` (HEAD of `visual-framework-copa-canonical`, identical to `main`).

Root tokens (`:root`, lines 24–39):

```
--bg:        #07141b
--bg2:       #0d2028
--bg3:       #10252d
--border:    #1f3b45
--border2:   #29444d
--green:     #2fe56e
--green-dk:  #03130b
--text:      #eef7f1
--muted:     #9cb2b9
--danger-bg: #3d1520
--danger-tx: #ffdbe1
--danger-br: #8e2d42
--gold:      #f59e0b
--red:       #ff6b6b
```

Base body: `font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
font-size: 15px; line-height: 1.5; background: var(--bg); color: var(--text);`.
Breakpoints used throughout: `max-width: 900px`, `max-width: 500px`, `max-width: 480px`,
`min-width: 901px`.

---

## Found with real values (28)

### 1. app-shell
No single `.app-shell`/`.container` wrapper class exists. The shell is implicit:
`html, body { overflow-x: hidden; overflow-x: clip; }` (line 46) + `body` base rule (lines 47–54)
+ `main { max-width: 1140px; margin: 0 auto; padding: 20px 18px; }` (line 179, the actual content
width constraint). Mobile: `main { padding: 12px 10px; }` at ≤900px (line 895).

### 2. topbar
Selector: `.topbar` (lines 76–89).
`position: sticky; top: 0; z-index: 20; background: rgba(7,20,27,.94);
backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); display: flex;
align-items: center; gap: 10px; padding: 10px 18px; flex-wrap: wrap;`
Mobile (≤900px, lines 907–918): becomes CSS grid, `grid-template-columns: minmax(0,1fr) auto`,
4 rows, `padding: 10px 12px; gap: 6px 8px`.
Desktop (≥901px, lines 1042–1048): grid, `grid-template-columns: minmax(0,1fr) auto auto auto`,
2 rows, `gap: 8px 12px`.

### 3. brand
Selector: `.brand` (lines 90–101) + `.brand span` (line 102, the subtitle).
`display: flex; gap: 8px; align-items: center; margin-right: auto; font-weight: 900;
font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
Subtitle span: `color: var(--muted); font-size: 12px; font-weight: 400;`
Mobile: subtitle span is `display: none` (line 924) — text-overflow:ellipsis doesn't render on a
multi-child flex container, so the subtitle is hidden outright rather than left visibly clipped.

### 4. tournament-title
No distinct `.tournament-title` component exists. Section headings use plain `h2`/`h3`
(`h1, h2, h3 { margin: .15em 0 .4em; } h2 { font-size: 1.25rem; } h3 { font-size: 1.05rem; }`,
lines 190–192). The brand mark itself doubles as the app/tournament identity (see #3).

### 5. support-button
Selector: `.whatsapp-btn` (lines 103–116).
`display: inline-flex; gap: 6px; align-items: center; background: #25D366; color: #000;
text-decoration: none; border-radius: 999px; padding: 8px 13px; font-weight: 900;
font-size: 13px; white-space: nowrap;` Icon img: `width: 18px; height: 18px;`
Mobile: `font-size: 12px; padding: 7px 10px;` (line 925).

### 6. language-switcher
Selector: `.lang-links` (line 134) + `.lang-links button` (lines 135–143) +
`.lang-links button.active` (lines 144–148).
Container: `display: flex; gap: 5px; align-items: center; flex-wrap: wrap;`
Button: `background: var(--bg3); color: var(--text); border: 1px solid var(--border2);
border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 700;`
Active state: `background: var(--green); color: var(--green-dk); border-color: var(--green);`

### 7. tournament-switcher
Selector: `.bolao-switcher select` (lines 119–131) + `:focus` (line 132).
`appearance: none; background: var(--bg3); color: var(--text); border: 1px solid var(--border2);
border-radius: 999px; padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer;
width: auto;` Focus: `border-color: var(--green);`
Mobile: full-width own row, `.bolao-switcher select { width: 100%; }` (line 927).

### 8. primary-tabs
Selector: `.nav` (line 154) + `.nav button` (lines 155–172) + `.nav button.active` (173–176).
Base (fallback, pre-media-query): `display: grid; grid-template-columns: repeat(6, minmax(0,1fr));
gap: 5px; width: 100%;`
Button: `background: var(--bg3); color: var(--text); padding: 8px 6px; font-size: 13px;
font-weight: 700; border: 1px solid transparent; min-height: 44px (WCAG touch target);
display: flex; align-items: center; justify-content: center;`
Active: `background: var(--green); color: var(--green-dk);`
Mobile (≤900px): `grid-template-columns: repeat(3, minmax(0,1fr)); font-size: 11px; padding: 8px 4px;`
Desktop (≥901px): `grid-template-columns: repeat(6, minmax(0,1fr)); font-size: 13px; padding: 8px 6px;`

### 9. page-container
Selector: `main` (line 179) — see #1. `max-width: 1140px; margin: 0 auto; padding: 20px 18px;`.
Section visibility toggled via `.page { display: none; } .page.active { display: block; }`
(lines 507–508).

### 10. section-heading
Selector: `.section-head` (line 509, `margin-bottom: 14px`) + `.section-head-row` (line 510,
`display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;`). Heading
text itself is a plain `h2`/`h3` (see #4). Accessibility: `h2:focus, h3:focus { outline: none; }`
(line 1081) — headings receive `tabindex="-1"` + `.focus()` on tab switch for screen readers, ring
intentionally suppressed since it's never reached by real keyboard Tab navigation.

### 11. card
Selector: `.card` (lines 181–188).
`background: var(--bg2); border: 1px solid var(--border); border-radius: 18px; padding: 18px;
margin-bottom: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.22);`

### 12. game-card
Selector: `.game-card` (lines 829–835) + `.game-card.is-live` (line 853).
`background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 14px;
margin-bottom: 10px;` Live variant: `border-color: var(--red);`

### 13. game-row
No single `.game-row` — the equivalent internal layout is `.game-top` (lines 836–843,
`display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
margin-bottom: 8px;`) plus `.game-teams` (lines 856–861, `display: grid;
grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center;`). Knockout bracket uses the
analogous `.match-card`/`.match-head`/`.teams` (lines 611–643) with the same 3-column team layout.

### 14. team-name
No distinct `.team-name` component with its own values in Copa's base CSS — only a mobile
override targets `.team .team-name`/`.game-team .team-name`
(`overflow-wrap: break-word;`, lines 991/1003). The visible team text styling actually lives on
the parent: `.team { font-weight: 800; font-size: 15px; display: flex; align-items: center;
gap: 6px; }` (line 641) and `.game-team { font-weight: 800; font-size: 18px; display: flex;
align-items: center; gap: 6px; justify-content: flex-end; }` (line 862). `.right` modifier flips
justification/direction on both.

### 15. team-logo
Does not exist as an image/logo component. Copa renders team identity as an emoji flag inline
inside `.team`/`.game-team` (class `.team-flag`, but that class has **no base rule** anywhere in
`styles.css` — only two mobile-only overrides, `flex-shrink: 0` at lines 990 and 1002). There is
no image asset, sizing, or border-radius defined for team flags.

### 16. score
Selector: `.game-score` (lines 864–874) + `.game-score.is-live` (854) +
`.game-score.muted` (mobile-only override, lines 1008–1014).
`font-size: 22px; font-weight: 900; color: var(--text); text-align: center; background: var(--bg);
border: 1px solid var(--border2); border-radius: 12px; padding: 8px 14px; min-width: 80px;`
Live: `border-color: var(--red); color: var(--red);` Mobile (≤500px):
`min-width: 54px; font-size: 16px; padding: 6px 8px;`
Score input variant (bracket entry form): `.score-inputs input { text-align: center;
font-size: 20px; font-weight: 900; }` (line 646).

### 17. date / 18. time / 19. venue
No distinct `.game-date`/`.game-time`/`.game-venue` classes exist anywhere in Copa's CSS or
markup pattern — these are honestly absent as separate styled components. The only date/time/venue-
adjacent styled elements found are on the hero "next match" widget: `.hero-next-time`
(`font-size: 11px; color: var(--muted); margin-bottom: 4px;`, line 433) and `.hero-next-venue`
(`font-size: 11px; color: var(--muted); margin-bottom: 10px;`, line 438) — both scoped only to
that one hero widget, not reused for regular game cards. Regular game-card date/venue text is
unstyled/inherited (rendered via `.pill`, see #20, or `.game-meta` plain text).

### 20. status-badge
Selector: `.status-chip` (line 849) + variants `.done` / `.pending` / `.live` (850–852). Also
`.pill` (lines 627–633) used for match metadata chips (phase/date labels), and `.demo-badge`
(1084–1094) for demo entries.
`.status-chip { border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 900; }`
`.done`: `background: rgba(47,229,110,.15); color: var(--green); border: 1px solid rgba(47,229,110,.3);`
`.pending`: `background: var(--bg3); color: var(--muted); border: 1px solid var(--border2);`
`.live`: `background: #4a0e0e; color: var(--red); animation: live-pulse 1.6s ease-in-out infinite;`
`.pill`: `font-size: 11px; color: var(--muted); border: 1px solid var(--border2);
border-radius: 999px; padding: 4px 8px;`

### 21. probability-bar
Selectors: `.prob-bars` (1117–1126, container) + `.prob-bar` (1127–1138) +
`.home`/`.draw`/`.away` (1139–1141); plus a second variant `.prob-champ-bar` (1165–1173,
championship-odds table row bar) and `.poly-bar` (1177, Polymarket-sourced gradient override).
Container: `display: flex; border-radius: 6px; overflow: hidden; height: 28px; margin-top: 10px;
font-size: 11px; font-weight: 700; gap: 2px;`
Segment: `display: flex; align-items: center; justify-content: center; min-width: 6px;
padding: 0 4px; transition: width 0.7s ease; border-radius: 4px;`
Colors: home `#16a34a`, draw `#475569`, away `#1d4ed8` (all `color: #fff`).
Mobile (≤500px): label wraps (`white-space: normal; overflow: visible; text-overflow: clip;
font-size: 10px;`), container `height: auto; min-height: 30px;` (lines 1019–1027).

### 22. ranking-row
Selector: `.rank-row` (lines 682–692) + mobile overrides (963–978) +
`.rank-row.participant-row` (978, reused by Participants/Payment admin views with 3 cols instead).
`display: grid; grid-template-columns: 48px 1fr auto auto; gap: 10px; align-items: center;
background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 12px;
margin-bottom: 8px;`
Mobile: `grid-template-columns: 28px 1fr 40px auto; padding: 10px 12px; gap: 8px;
align-items: start;`

### 23. ranking-position
Selector: `.rank-pos` (line 693, `font-size: 22px; text-align: center;`) +
`.rank-arrow`/`.up`/`.down` (694–696, movement indicator, `font-size: 12px; vertical-align: super;`,
green up / `#ff6b6b` down) + `.rank-arrow-n` (811, numeric delta suffix). Mobile:
`.rank-row .rank-pos { font-size: 16px; }` (line 969).

### 24. ranking-score
Selector: `.points` (line 697). `font-size: 26px; color: var(--green); font-weight: 900;
text-align: right;` Mobile: `.rank-row .points { font-size: 17px; text-align: right; }` (971).

### 25. rules-table
Selector: `.rules-table` (877–879) + `.rules-list` (880–881).
`width: 100%; border-collapse: collapse; margin-top: 10px;`
`td { padding: 7px 10px; border-bottom: 1px solid var(--border); }`
`td:last-child { text-align: right; color: var(--green); font-weight: 900; }`

### 26. form-grid
Selector: `.form-grid` (565–569). `display: grid;
grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;` Mobile: collapses to `1fr` (897).

### 27. input
Selectors: `label` (572), `label span` (573, field label text), `input, select` (574–586) +
`:focus`/`:disabled` + number-spinner removal (589–591).
Label text: `font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;
letter-spacing: .04em;`
Field: `width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--border2);
background: var(--bg3); color: var(--text); outline: none; transition: border-color .15s;
appearance: none;` Focus: `border-color: var(--green);` Disabled: `opacity: .5;
cursor: not-allowed;` Readonly variant: `input[readonly] { background: var(--bg);
color: var(--muted); cursor: not-allowed; }` (795–799).

### 28. select
Shares the `input, select` base rule above (#27) — no separate select-only ruleset except the
two scoped selects already covered under #6 (`.lang-links` has no select) and #7
(`.bolao-switcher select`). No native custom-arrow styling beyond `appearance: none`.

### 29. checkbox
No native `<input type="checkbox">` styling exists anywhere in Copa's CSS. The one place a
boolean toggle appears (payment marked/unmarked in admin) is implemented as a **button**, not a
checkbox — explicitly noted in `docs/bolao/LESSONS_LEARNED.md` as a deliberate choice ("toggle
button, not checkbox"). No checkbox component to extract.

### 30. button
Selector: `button` base rule (59–68) + `:hover`/`:disabled` (69–70).
`border: 0; border-radius: 12px; padding: 11px 18px; background: var(--green);
color: var(--green-dk); font-weight: 900; cursor: pointer; transition: opacity .15s;`
Hover: `opacity: .88;` Disabled: `opacity: .45; cursor: not-allowed;`
Small variant: `.small-btn { padding: 7px 11px; font-size: 12px; border-radius: 9px;
white-space: nowrap; }` (73).

### 31. button-primary
The unmodified base `button` rule (#30) **is** the primary button — green fill,
`color: var(--green-dk)`. No separate `.primary`/`.button-primary` class exists; primary is the
default, unclassed state.

### 32. button-secondary
Selector: `button.secondary` (line 71). `background: var(--bg3); color: var(--text);
border: 1px solid var(--border2);`

### 33. button-danger
Selector: `button.danger` (line 72). `background: var(--danger-bg); color: var(--danger-tx);
border: 1px solid var(--danger-br);`

### 34. admin-toolbar
Selector: `.admin-toolbar` (886). `display: flex; gap: 8px; flex-wrap: wrap;
margin-bottom: 14px;` Individual admin entries: `.admin-entry { margin-bottom: 10px; }` (885).

### 35. admin-card
No distinct `.admin-card` class exists. Admin panels reuse the plain `.card` component (#11)
directly — confirmed by grepping `index.html`/`app.js` render templates; no admin-specific card
variant is defined in CSS.

### 36. toast
Selector: `.bolao-toasts` (container, 1269–1279) + `.bolao-toast` (1280–1291) + type variants
`.success`/`.error`/`.warn`/`.info` (1292–1295) + `@keyframes toast-in` (1296–1299).
Container: `position: fixed; bottom: 20px; right: 16px; display: flex; flex-direction: column;
gap: 8px; z-index: 10000; pointer-events: none; max-width: 320px;`
Toast: `padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
line-height: 1.4; box-shadow: 0 4px 16px rgba(0,0,0,0.45); animation: toast-in 0.2s ease;
transition: opacity 0.3s ease; word-break: break-word;`
success: `background: #0f2a0f; color: #69c569; border-left: 3px solid #4caf50;`
error: `background: #2a0f0f; color: #f08080; border-left: 3px solid #e05050;`
warn: `background: #2a1f00; color: #ffcc66; border-left: 3px solid #ff9800;`
info: `background: #0d1f33; color: #80c8f0; border-left: 3px solid #4a9fd4;`
Mobile (≤480px): `.bolao-toasts { right: 8px; left: 8px; max-width: none; }` (1300–1302).
Per `docs/bolao/PROJECT_MEMORY.md`, toasts deliberately replace `alert()` everywhere **except**
form-validation errors and popup-blocked warnings (kept as `alert()`), and destructive actions
(kept as blocking `confirm()`).

---

## Do not distinctly exist in Copa's actual code (8) — not invented

- **empty-state** — no `.empty-state` class or reusable pattern. Empty states are plain
  translated strings inserted via `t()` (e.g. `noEntries: "Nenhuma entrada registrada ainda."`,
  `js/i18n.js:66`; `auditLogEmpty`, `js/i18n.js:225`; `noKnockoutResults`/`noEspnResults`/
  `noNewResults`, `js/i18n.js:256-258`) with no dedicated container/icon styling — just text in
  whatever ambient container it's placed in.
- **loading-state** — no `.loading`/`.spinner`/`.skeleton` class anywhere in `styles.css`. No
  loading-state visual component exists; the app does not show a distinct loading UI while
  fetching (ESPN/Supabase) beyond ordinary DOM update.
- **error-state** — no `.error-state`/`.error-banner` component. The closest thing is the generic
  `.warning` box (464–472, `background: #fff4cc; color: #392d00; border: 1px solid #e8c65b;
  border-radius: 12px; padding: 10px 12px; font-size: 13px; margin-top: 10px;`), which is a
  content-warning banner (e.g. cutoff/edit-mode notices), not an error/fetch-failure component,
  and the `.bolao-toast.error` variant (see toast, #36) for transient error messages — no
  persistent inline error-state block exists.
- **modal** — no `.modal`/`.dialog`/`.overlay` class anywhere in the CSS. Confirmed: the app uses
  native `alert()`/`confirm()` for blocking interactions (per `PROJECT_MEMORY.md`, deliberately,
  for form validation, popup-blocked, and destructive-action confirmation) instead of a styled
  modal component. No modal to extract.
- **team-logo** — covered above under #15: only emoji flags inline in text, no image/logo
  component, no `.team-flag` base styling (only two mobile flex-shrink overrides).
- **date / time / venue** as distinct reusable components — covered under #17–19: only two
  narrowly-scoped hero-widget classes (`.hero-next-time`, `.hero-next-venue`) exist; there is no
  general-purpose `.game-date`/`.game-time`/`.game-venue` used across game cards.
- **checkbox** — covered under #29: the one boolean-toggle UI in the app (admin payment mark) is
  implemented as a button, not a native checkbox; no checkbox styling exists to extract.
- **tournament-title** as a distinct component — covered under #4: no separate title component,
  the brand mark and plain `h2`/`h3` headings serve that role.

---

## Notes for later phases

- Copa is a single 1302-line CSS file with no CSS custom-property scoping beyond the 14 root
  tokens listed at the top — phase 2's `bolao/shared/css/` token extraction should start from
  that `:root` block plus the breakpoints (`900px`/`500px`/`480px`/`901px`) used throughout.
  `#heroCard` is currently `display: none` (461–463) — dead-but-present code, worth flagging
  before shared-shell migration decides whether to carry it forward.
- Several components above are reused across more than one screen with only a modifier class
  differing (`.rank-row` also serving Participants/Payment via `.participant-row`; `.card` also
  serving as the de-facto admin card) — later phases should preserve that reuse pattern rather
  than fork new components per screen.
- `.status-chip` and `.pill` overlap conceptually (both render small bordered/pill labels) but
  are visually and semantically distinct in the source — kept as two separate catalog entries
  rather than merged, since inventing a merger wasn't asked for.
