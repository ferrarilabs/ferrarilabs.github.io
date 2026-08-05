# Powerball Email Architecture

Scope: `bolao/loterias/powerball/` only. Independent from Copa2026/BR2026/CDB2026
(no shared code, no shared templates, no shared outbox).

## Existing state before this change (audit findings)

- **Participants** live as plain objects inside `js/data.js`
  (`window.POWERBALL_DRAWS[i].participants[]`), fields: `name, cotas, valor,
  metodo, data, hora, txId, status, state, email`. There is **no browser admin
  panel** for this app — participants are added by directly editing
  `js/data.js`, via `scripts/add_participants.py` / `scripts/add-participant.js`
  (regex-based insertion) or `scripts/add_participant_to_supabase.py`. This is
  a static-content pattern, not a live admin UI with a save button.
- **Prize calculation** (jackpot / lump sum / annuity / tax) lives in
  `js/app.js` as `calculatePrizePerParticipant(draw, participant)` (originally
  private to the page's IIFE). It reads `STATE_TAX_RATES` (`FL: 0`, `NC:
  0.0399`) and `FEDERAL_TAX_RATE` (0.37), and returns `stateKnown: false` with
  `null` net figures when the participant's `state` isn't in
  `STATE_TAX_RATES` — i.e. it already refuses to guess.
- **Email provider**: EmailJS (see `js/config.js`) — `publicKey:
  GBZFujsJBET6modve`, `serviceId: service_o4hyzxr`,
  `participantTemplateId: template_xq7yzzb`, `adminTemplateId:
  template_4sgp5r9`. `scripts/send_result_email.py` already sends server-side
  via the EmailJS REST API (`https://api.emailjs.com/api/v1.0/email/send`)
  with the exact headers this new code reuses (Origin/Referer spoofed to the
  site's own domain, as EmailJS requires for a configured service).
- **No outbox / send-history existed.** `send_result_email.py` sends
  synchronously with no idempotency tracking beyond a log file.
- **No PDF/CSV/manifest/hash existed** for ticket publication.

## What this change adds

New directory `scripts/email/` (ESM `.mjs`, zero npm dependencies):

| File | Responsibility |
|---|---|
| `prize-calc-bridge.mjs` | Loads the **real** `js/data.js` + `js/app.js` in a Node `vm` sandbox and returns the exact `calculatePrizePerParticipant` function object. This is the single reuse point — no formula is duplicated anywhere else in this feature. |
| `snapshot.mjs` | `loadParticipantSnapshot`, `loadDrawSnapshot`, `loadFinancialEstimates` — read-only, returns deep clones. |
| `validate.mjs` | `validateParticipantConfirmation`, `validateTicketPublication`, `eligibleRecipients` — decisions only, no I/O. |
| `payload.mjs` | `buildParticipantConfirmationPayload`, `buildTicketPublicationPayload`, `manifestToCsv`, `sha256Hex` — pure transforms. |
| `render.mjs` | `renderEmailSubject`/`Html`/`Text` per template (`renderParticipantConfirmation*`, `renderTicketPublication*`). Inline CSS only, no `<script>`. |
| `pdf.mjs` | Minimal hand-rolled text PDF writer (no dependency) for the publication manifest PDF. |
| `outbox.mjs` | `enqueueEmailJob`, `recordEmailResult`, file-backed JSON store (`scripts/email/outbox.json`), idempotency by key. |
| `send.mjs` | `sendEmailJob` — the only function that calls the EmailJS REST API. |
| `send_participant_confirmation.mjs` | Flow A orchestrator/CLI. |
| `publish_tickets.mjs` | Flow B orchestrator/CLI. |
| `correct_tickets.mjs` | Correction-flow orchestrator/CLI, versioned manifests under `scripts/email/manifests/`. |
| `generate_previews.mjs` | Builds the evidence files under `email-previews/` from synthetic data. |

`js/app.js` gained one additive line (`window.POWERBALL_PRIZE_CALC = {
calculatePrizePerParticipant }`) right after the function definition, so both
the public page (unchanged behavior) and the Node-side email code load the
identical function — no visual or logic change to the public page.

## Architectural decision: CLI, not a web admin panel

The spec described a browser admin UI ("preview desktop/mobile/text-plain",
"send test to admin" button, confirmation dialog). This app has **no existing
admin web page** — every "admin action" (adding participants) is already a
script run by Eduardo locally. Building a full browser admin panel would be a
much larger, riskier change with no existing precedent in this app. Instead,
the two admin actions are implemented as CLI scripts matching the existing
`scripts/add_participants.py` convention:

- `node scripts/email/send_participant_confirmation.mjs --draw-id ... --participant "..." [--test] [--to ...]`
- `node scripts/email/publish_tickets.mjs --draw-id ... --version N [--test] [--to ...] [--proof-url ...]`
- `node scripts/email/correct_tickets.mjs --draw-id ... --version N --previous-version N-1 --reason "..." [--test]`

Preview/download equivalents are `--dry-run` (returns subject/html/text/pdf
without sending) and `generate_previews.mjs` (writes files to
`email-previews/`). This is a deliberate scope adaptation — flagged here per
governance rules rather than silently built as a web UI that doesn't match
the rest of the app.

## Outbox / idempotency

Persisted at `scripts/email/outbox.json` (file-backed, not localStorage —
this code runs server-side/CLI, not in the browser). Idempotency key patterns:

- Flow A: `powerball:{poolId}:participant-added:{participantId}:v{templateVersion}`
- Flow B: `powerball:{poolId}:{drawId}:tickets-published:v{publicationVersion}.{templateVersion}:{participantId}`

Retrying an existing key returns the original frozen `payloadSnapshot`
unchanged (see `outbox.mjs::enqueueEmailJob`) — a second run never recomputes
or resends.

## Known limitation (flagged, not fixed silently)

The spec's mobile-preview PNGs were captured via the `claude-in-chrome` tool;
the sandboxed browser window did not honor a 390px viewport resize in this
session (screenshots came back at the tab's actual rendered width). The saved
`*-mobile.png` files are therefore JPEG screenshots of the desktop HTML render
at the tool's default resolution, not a true narrow-viewport capture. The
HTML/CSS itself uses a fluid `max-width:600px` table layout, the same pattern
already used by the site's public page — genuine mobile-width verification
(a real phone or DevTools device toolbar) is recommended before production
activation.
