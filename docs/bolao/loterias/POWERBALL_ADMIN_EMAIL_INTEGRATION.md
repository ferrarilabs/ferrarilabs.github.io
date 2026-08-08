# Powerball Admin — Email Outbox Integration Plan (documentation only, no code changes)

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado** (NÃO EXECUTADO). This entire document is planning only — nothing here has been
implemented, and nothing in `powerball-email-professionalization` (already merged to main) was
touched to produce it.

## The real mismatch, stated plainly

These are two genuinely different systems today, not just "not yet connected":

| | Admin outbox (this branch) | Email worker (`powerball-email-professionalization`, already merged to main) |
|---|---|---|
| Storage | Supabase table `lottery_email_jobs` / `lottery_email_deliveries` (proposed, NÃO EXECUTADO — never applied to a real DB) | A local JSON file, `scripts/email/outbox.json`, read/written by `outbox.mjs`'s `readAll()`/`writeAll()` |
| Runtime | Browser (admin UI) enqueues via `admin_enqueue_email` RPC; nothing else consumes the queue yet | Node.js CLI scripts (`send_participant_confirmation.mjs`, `publish_tickets.mjs`, `correct_tickets.mjs`) run manually/by a human, orchestrating `outbox.mjs` + `send.mjs` in one process |
| Sending | Not implemented — `admin_enqueue_email`/`admin_retry_email`/`admin_cancel_email_job` only ever touch the Supabase row, there is no "worker" polling it | `send.mjs`'s `sendEmailJob(job, {...})` calls the EmailJS REST API directly, in the same process that enqueued the job |
| Idempotency | `lottery_email_jobs` has no idempotency-key column in the current schema | `outbox.mjs`'s `idempotencyKeyForParticipant`/`idempotencyKeyForPublication` + `findByIdempotencyKey()` |

In short: today, enqueuing a row in the Supabase admin outbox does **nothing** — there is no
process reading `lottery_email_jobs` and calling EmailJS. The actual, working send path is
entirely separate (file-backed, CLI-driven) and does not know the admin outbox table exists.

## What "wiring them together" would actually require

Two viable directions — recommending neither yet, listing both honestly since the right choice
depends on constraints (deployment target, whether a long-running Node process is acceptable,
whether GitHub Pages-only hosting is still a hard requirement) that weren't specified:

### Option A — Make `lottery_email_jobs` the single source of truth, retire `outbox.json`

- A new small Node worker (could reuse `send.mjs`'s `sendEmailJob` almost as-is — its signature
  `sendEmailJob(job, { publicKey, serviceId, templateId, htmlMessage, subject })` doesn't care
  where `job` came from) polls Supabase (`select * from lottery_email_jobs where status =
  'pending'`) instead of reading `outbox.json`.
- **Missing on the admin-schema side**: `lottery_email_jobs` as currently designed
  (`migrations/001_schema.sql`) has `job_type, entity_type, entity_id, recipient_email, status,
  attempts, last_error` — it does **not** yet have the fields the real send path actually needs:
  `html_message`, `subject`, `template_id`, and an idempotency key column (equivalent to
  `outbox.mjs`'s `idempotencyKeyForParticipant`/`idempotencyKeyForPublication`). These would need
  to be added in a follow-up schema migration before a real worker could function.
  `admin_enqueue_email`'s RPC signature would also need to grow those parameters.
- **Missing on the email-branch side**: `send.mjs`/`outbox.mjs` would need a Supabase-backed
  alternative to `readAll()`/`writeAll()`/`recordEmailResult()` (currently pure file I/O) — e.g.
  swapping the file read/write for `supabase.from('lottery_email_jobs')` calls, guarded by a
  service-role key (server-side only, since this worker would run outside the browser — e.g. a
  scheduled GitHub Action or a small always-on process, not client-side JS).
- **Where it runs**: needs to run somewhere with the service_role key — never in the browser.
  A GitHub Action on a schedule (matching this repo's no-build-step, static-hosting pattern) is
  the most consistent option with how the rest of this repo is deployed, but that means sends
  are not instantaneous — bounded by the schedule interval. An always-on worker would need
  hosting this repo doesn't currently have.

### Option B — Keep them separate, admin outbox becomes a request queue an operator drains manually

- The admin `lottery_email_jobs` table stays as a durable "intent to send" record with full audit
  trail (via `lottery_admin_audit`), but a human periodically exports pending rows and feeds them
  into the existing `send_participant_confirmation.mjs`/`publish_tickets.mjs` CLIs by hand (or a
  small export script translates a Supabase row into the CLI's expected input shape).
- Lower engineering cost, but reintroduces a manual step and breaks the "admin confirms → RPC
  creates jobs → worker processes → delivery recorded → admin observes status" flow the original
  task spec asked for — flagged as a real trade-off, not hidden.

## Recommendation (for Eduardo to decide, not decided here)

Option A is architecturally cleaner and matches the original spec's persisted-outbox intent, but
costs more: a schema change (new columns + migration), an RPC signature change, and a new
worker process with somewhere to run that holds the service_role key. Option B costs less but
keeps a manual step and two sources of truth. This document does not choose for you — it exists
so the choice can be made deliberately rather than assumed.

## What was explicitly NOT done here

- No code in `bolao/loterias/powerball/scripts/email/` (the already-merged branch's code) was
  read for the purpose of modifying it, and none of it was changed.
- No new worker script was written.
- No schema migration adding the missing columns was written — that's future work once Option
  A/B is chosen.
- `admin/js/app.js`'s E-mails screen (`renderEmails()`) is unchanged by this document; it still
  only manages the `lottery_email_jobs` table's rows via `admin_enqueue_email`/
  `admin_retry_email`/`admin_cancel_email_job`, with no consumer reading them yet.
