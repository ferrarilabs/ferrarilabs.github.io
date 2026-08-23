# Powerball Email — Test Plan

## Automated (`node scripts/audit_email_tests.mjs`, no network)

23 assertions across 9 groups — run before any real send, same gating spirit
as `audit_scoring.py`:

1. **Prize calculation reuse** — known state (NC) returns a full estimate;
   FL (0% state tax) nets more than an equal-cota NC participant (sanity
   check on the real formula, not reimplemented here); unsupported/missing
   state returns `stateKnown:false` and null net figures.
2. **Flow A validation** — missing/unsupported state blocks with
   `PARTICIPANT_STATE_UNSUPPORTED`; invalid email blocks; valid known-state
   participant passes; payload never includes other participants' emails;
   payload contains no `txId` / banking details.
3. **Outbox idempotency** — new participant enqueues one job; retry with the
   same key does not duplicate; re-enqueueing after an "edit" (same
   participantId+version) does not create a second job.
4. **End-to-end dry runs** — Flow A sends only to the participant's own
   address; Flow A blocks + offers "Reenviar confirmação de entrada" on
   unsupported state; Flow B creates exactly one job per eligible recipient
   even with a 3-cota participant; Flow B excludes cancelled/zero-cota/
   invalid-email participants; `validateTicketPublication` blocks on empty/
   invalid inputs.
5. **Financial reconciliation** — `financialSummary` totals equal
   `draw.finance.*` and `sum(cotas)`.
6. **Snapshot immutability** — `loadDrawSnapshot` returns a deep clone;
   retrying an idempotency key reuses the original frozen `payloadSnapshot`,
   never a recomputed one.
7. **Hash consistency** — the manifest's own `sha256` matches an independent
   recomputation, and appears verbatim in the HTML email and the CSV.
8. **Correction versioning** — a correction payload has `templateId:
   "tickets-corrected"`, a different hash than v1, and `previousHash` set to
   v1's hash.
9. **PDF sanity** — output starts with `%PDF-` and contains `%%EOF`.

Run: `python3 bolao/copa2026/scripts/audit_scoring.py && python3
bolao/br2026/scripts/audit_scoring.py && python3
bolao/cdb2026/scripts/audit_scoring.py && node
bolao/loterias/powerball/scripts/audit_email_tests.mjs` — all four must pass
before any commit that touches this repo (per CLAUDE.md's platform-wide
scoring-audit rule, even though this feature doesn't touch scoring).

## Manual / gate (this session)

3 real EmailJS sends, synthetic payload (Participante Alfa /
participante.alfa@example.invalid / SYNTH000000027 / NC), real recipient
`emferrari@gmail.com` only, `[TESTE ADMIN]` prefix, `testMode:true` recorded
in `scripts/email/outbox.json`. Results in
`bolao/loterias/powerball/email-previews/email-test-results.txt`.

## Not yet covered (flagged for follow-up, not silently skipped)

- No real inbox rendering check across Gmail/Outlook/Apple Mail clients
  beyond inline-CSS conventions matching `send_result_email.py`'s existing
  approach — recommend Eduardo visually confirm the 3 test emails in his own
  inbox before activation.
- True mobile-viewport screenshot (see limitation noted in
  `POWERBALL_EMAIL_ARCHITECTURE.md`).
- Supabase-backed outbox (spec says "not localStorage-only" — this
  implementation uses a file-backed JSON store, which satisfies that, but a
  shared Supabase table like `bolao_state` would be needed if multiple
  machines run these CLIs against the same outbox; not built in this pass,
  see Operations Runbook "Rollback / not done" section).
