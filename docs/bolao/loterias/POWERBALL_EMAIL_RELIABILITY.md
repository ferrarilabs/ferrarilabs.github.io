# Powerball — Email Reliability

## What "automatic" means today vs. what it should mean

See `POWERBALL_INCIDENT_REVIEW.md` Incident 1 for the full root cause. Summary classification
(spec Part 3):

| Event | Status | Notes |
|---|---|---|
| Abertura do bolão | AUSENTE | No email exists for this at all |
| Confirmação de participação | AUSENTE | Same |
| Confirmação de pagamento | AUSENTE | Payments are recorded (when Admin works at all) with no receipt email |
| Tickets publicados | AUSENTE | `sharedTickets` shows on the page; no email when it changes |
| Lembrete antes do sorteio | AUSENTE | No reminder logic anywhere in `app.js` |
| Resultado disponível | MANUAL (mislabeled as automatic) | Depends entirely on a browser loading the page after the draw — see Incident 1 |
| Prêmio identificado | MANUAL | Same code path as above, no separate trigger |
| Nenhum prêmio | MANUAL | Same |
| Próximo sorteio criado | AUSENTE | New draw = a git commit; no notification |
| Correção administrativa | AUSENTE | No admin exists to correct anything from (Incident 3) |

Zero rows are `IMPLEMENTADO`. One is real but mislabeled (`MANUAL`, not `AUTOMÁTICO` — a real
automatic path was built once for exactly this event, on the abandoned
`claude/lottery-countdown-timer-ns0nlt` branch, and never merged forward).

## The outbox model (implemented, local, tested)

`bolao/loterias/powerball/scripts/lib/`:

- **`email_outbox.mjs`** — `EmailOutbox` class. In-memory store matching the schema in
  `POWERBALL_DATA_MODEL.md`'s `lottery_email_jobs` table exactly (`email_job_id`, `pool_id`,
  `draw_id`, `event_type`, `recipient`, `template_id`, `template_version`, `payload_snapshot`,
  `idempotency_key`, `status`, `attempt_count`, `last_attempt_at`, `sent_at`, `provider_status`,
  `provider_message_id`, `last_error`, `created_at`). States: `pending → processing → sent |
  failed → (retry back to pending) | cancelled | suppressed`. `idempotency_key` format:
  `powerball:{draw_id}:{event_type}:{recipient}:{template_version}` exactly as the spec
  specifies. `enqueue()` throws `DuplicateEmailJobError` rather than silently ignoring a repeat —
  callers can catch and treat that as "already queued," which is the actual desired behavior, not
  a bug.
- **`email_pipeline.mjs`** — the render/transport split (spec Part 5): `loadDrawSnapshot()`,
  `validateEmailEvent()`, `buildEmailPayload()`, `renderEmailSubject()`, `renderEmailHtml()`,
  `renderEmailText()`. `buildEmailPayload()` is the single point where live app state is read;
  everything downstream operates on the frozen `payload_snapshot` it returns, which is what makes
  a retry resend byte-identical content instead of recomputing against whatever `data.js`/
  `localStorage` happen to say *now*.
- **`email_worker.mjs`** — `FakeEmailProvider` (records sends, never touches the network) and
  `runWorkerOnce()`, which claims jobs, renders, sends via the given provider, and records
  success/failure per job without one failure blocking the batch. Supports `dryRun` and
  `rateLimitMs`.

## Tests (real, passing)

`bolao/loterias/powerball/scripts/tests/email_outbox.test.mjs` — 16 tests, run via
`node --test`, all passing as of this branch (see `POWERBALL_TEST_STRATEGY.md` for the full run
output). Covers every guarantee the spec lists: no duplicate send, no wrong-draw send, no
wrong-template send, no cross-participant data leakage, no missing-recipient send, no incomplete
payload, no early send, retry preserves the snapshot, retry doesn't duplicate, one recipient's
error doesn't block others, preview equals what was actually sent, and rate limiting is honored.
Only `@example.invalid` addresses used anywhere.

## Coverage gaps, stated plainly

- **Timezone/rate-limit against the real EmailJS service** are not exercised — `FakeEmailProvider`
  never calls the network, by design (spec explicitly forbids real sends in tests). The real
  30-second EmailJS throttle documented for the other three bolão apps' EmailJS usage is not
  independently re-verified for Powerball's account here.
- **`correcao_administrativa` and a few other event types** render with a generic subject/body —
  `renderEmailSubject()`/`renderEmailHtml()` cover the cases with real content in the codebase
  today (result-related, reminder, payment, tickets) but not a fully bespoke template for every
  event in the spec's list, since several of those events are `AUSENTE` in the underlying app —
  there's nothing to build a faithful preview *of* yet. See `POWERBALL_PROFESSIONALIZATION_REPORT.md`.
- **"Resultado pendente" / "erro da API oficial" scenarios** are page states (`pbResultPending`,
  `pbResultRetryBtn` in `index.html`), not email events — no email is sent in either case today,
  correctly, so there is no email preview to generate for them. Noted rather than faked.

## Not done in this branch (explicitly, per the spec's own prohibitions)

The worker is not deployed, no GitHub Action is added or modified, no Supabase table exists to
back the outbox in production, and EmailJS is never called for real. This is the local,
reviewable reference implementation the spec asked for — turning it into the thing that actually
sends Powerball's emails requires the Data Model migration (`POWERBALL_DATA_MODEL.md`) to land
first, and is filed as the top item in `POWERBALL_PROFESSIONALIZATION_REPORT.md`.
