# Powerball — Flow B: Ticket Publication Email

## Trigger

Explicit admin action only — never automatic per-ticket-entered:

```bash
node scripts/email/publish_tickets.mjs --draw-id 2026-08-05 --version 1 [--proof-url URL]
```

One job per **eligible** recipient — `eligibleRecipients()` in
`scripts/email/validate.mjs` filters to: valid email, `cotas > 0`,
`status !== "cancelado"`. A participant is one row in `draw.participants`
regardless of cota count, so multi-cota participants get exactly one email
(covered by the "multi-cota participant still gets exactly one" test).

## Pre-publish validation (`validateTicketPublication`)

Blocks with a specific error code when: no tickets (`NO_TICKETS`), an
incomplete/invalid ticket — not exactly 5 numbers + special
(`INVALID_TICKET`), missing draw date (`MISSING_DRAW_DATE`), no participants
(`NO_PARTICIPANTS`), any invalid recipient email
(`PARTICIPANT_EMAIL_INVALID`), draw already concluded — has a saved result
and its date has passed (`DRAW_ALREADY_CONCLUDED`), or stale ticket data
(`TICKET_DATA_STALE`, checked via a `draw.__stale` flag set by the caller
when it knows its snapshot is out of date).

## Contents (per recipient)

Draw identification, financial summary (`participantCount, totalCotas,
valorPorCota, totalArrecadado, valorUsado, saldoReservado, ticketCount,
totalCost, powerPlay`), the recipient's own `individualParticipation` only
(never other participants'), the **full** ticket list unmodified from the
frozen snapshot, a proof-of-purchase link when `--proof-url` is given, the
auditable JSON manifest (`poolId/drawId/publicationVersion/publishedAtUtc/
tickets[]` + `sha256`), the same manifest as CSV
(`payload.mjs::manifestToCsv`), a consolidated PDF (`pdf.mjs`) with the same
data + hash, a "Como conferir" section showing the SHA-256 so the recipient
can compare it against the PDF/CSV, and next-steps text.

## Hash

`sha256Hex(stableStringify(manifest-without-hash))` — deterministic
(sorted-key JSON) so the same ticket set always hashes the same regardless of
key order. The same hash string is embedded in the HTML email, the text
email, the CSV, and the PDF — verified by an automated test
("hash in HTML email, CSV, and PDF text all match the manifest's own sha256").

## Test mode

`--test [--to email]`: only **one representative send** is actually
dispatched (loop breaks after the first recipient in test mode) to avoid
burning EmailJS quota/looking like a real broadcast; subject gets `[TESTE
ADMIN]` prefix; `testMode: true` recorded per job.
