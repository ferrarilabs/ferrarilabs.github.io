# Powerball — Flow A: Participant Confirmation Email

## Trigger

Manual CLI run after a participant is added to `js/data.js` (this app has no
save-button admin UI — see `POWERBALL_EMAIL_ARCHITECTURE.md` for why):

```bash
node scripts/email/send_participant_confirmation.mjs \
  --draw-id 2026-08-05 --participant "Jane Doe"
```

Sends **exactly one** email to that participant's own `email` field. Never a
bulk To/CC. Never sent on participant *edits* — the idempotency key is
`participantId + templateVersion` only, so re-running after an edit is
deduped (see test: "editing an existing participant... does not trigger a new
confirmation job").

## Contents

Name, pool id, entry date, next draw date, cotas, valor, payment status,
participation % (`cotas / totalCotas` for that draw), and "Estimativas do
prêmio atual" (jackpot, lump sum, annuity) computed by
`window.POWERBALL_PRIZE_CALC.calculatePrizePerParticipant` — the exact
function `js/app.js` uses for the public table. No parallel formula exists.

## State-missing / unsupported-state blocker

If `calculatePrizePerParticipant` returns `stateKnown: false` (state missing
or not in `STATE_TAX_RATES`), `validateParticipantConfirmation` returns
`{ ok: false, errors: ["PARTICIPANT_STATE_UNSUPPORTED"] }` and **no email is
sent**. The CLI's JSON output includes
`"retryAction": "Reenviar confirmação de entrada"` — once the participant's
`state` is fixed in `js/data.js`, re-run the same command (same
`participantId`); because the state fix changes `estimates`, not the
idempotency key, the retry is allowed to send (the key was never consumed by
a *sent* job — enqueue only happens after validation passes).

## Idempotency

Key: `powerball:{poolId}:participant-added:{participantId}:v{templateVersion}`.
Double-click / page reload / second terminal running the same command is a
no-op after the first successful enqueue — see `outbox.mjs`.

## Test mode

`--test [--to email]` sends with `[TESTE ADMIN]` subject prefix, `testMode:
true` recorded in the outbox, real recipient forced to `emferrari@gmail.com`
(or `--to`) regardless of the participant's real address.
