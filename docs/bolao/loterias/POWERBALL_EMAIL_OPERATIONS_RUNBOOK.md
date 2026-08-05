# Powerball Email — Operations Runbook

Status as of this branch: **implemented and test-gated, NOT activated for
production.** No production trigger is wired up; every send so far used
`--test` with the real recipient forced to `emferrari@gmail.com`.

## Triggers (once activated)

- Flow A: run `node scripts/email/send_participant_confirmation.mjs
  --draw-id <id> --participant "<name>"` immediately after adding the
  participant to `js/data.js` (manually, or by adding this call to the end of
  `add_participants.py` — not done in this pass, see "Not activated" below).
- Flow B: run `node scripts/email/publish_tickets.mjs --draw-id <id>
  --version 1 [--proof-url <url>]` only when Eduardo is ready to publish —
  this is the explicit "Publicar bilhetes e notificar participantes" action.
- Corrections: `node scripts/email/correct_tickets.mjs --draw-id <id>
  --version N --previous-version N-1 --reason "<why>"`.

## Recipients

Flow A: the single participant's own `email`. Flow B/corrections:
`eligibleRecipients()` — valid email, `cotas>0`, not cancelled. Test mode
always overrides the actual recipient to `emferrari@gmail.com` regardless of
computed recipients.

## Idempotency / retry

See `POWERBALL_EMAIL_ARCHITECTURE.md`. To force a resend after a legitimate
data fix (e.g. state corrected), the participant's underlying data change
does not by itself invalidate the key — only a `templateVersion` bump does.
For the one-off "state was wrong, now fixed" case, the original failed
validation never created a job (enqueue happens after validation), so simply
re-running the same command retries cleanly.

## Snapshots

Every payload embeds a deep-cloned snapshot of the draw/participant at
enqueue time (`snapshot.mjs`). Retries reuse the stored `payloadSnapshot`
from the outbox record, never recompute against live data.

## Corrections

Never overwrite. `correct_tickets.mjs` writes a **new** file
`scripts/email/manifests/{drawId}.v{N}.json` and leaves
`{drawId}.v{N-1}.json` untouched. `previousHash` is embedded in the new
manifest payload so the diff is auditable from the email/PDF alone.

## Admin test flow

`--test [--to email]` on any of the three CLIs. Always prefixes the subject
with `[TESTE ADMIN]`, always forces the real recipient, always sets
`testMode:true` in the outbox record.

## Approval gate / activation (NOT done in this branch)

Per the task's hard stop: no production trigger wiring, no merge to `main`,
no deploy, zero real participants notified, no production Supabase writes.
To activate after approval:

1. Wire `send_participant_confirmation.mjs` into the actual participant-add
   step (either call it from `add_participants.py` via `subprocess`, or run
   it manually right after each add — Eduardo's call).
2. Add the `--version`/`--proof-url` real invocation to whatever runbook step
   currently corresponds to "tickets are finalized for this draw".
3. Remove `--test`/`overrideRecipient` from that real invocation.
4. Re-run `node scripts/audit_email_tests.mjs` once more against the branch
   that will merge, then merge to `main` following the normal release
   process in the root `CLAUDE.md`.

## Rollback

Nothing production-facing was changed. To fully back out this feature:
`git revert` the merge commit (once merged) — `js/app.js`'s one-line export
is additive and safe to leave even if reverted partially. No Supabase schema
was touched; no existing template was modified (a new `template_xq7yzzb`
reuse, not a new template registered in EmailJS — see "Known limitation:
single shared EmailJS template" below).

## Known limitation: single shared EmailJS template

`js/config.js` only defines two EmailJS template ids
(`participantTemplateId`, `adminTemplateId`), both generic
`{{{html_message}}}`-only templates per the platform convention documented in
the root `CLAUDE.md`. All three new flows reuse
`participantTemplateId` (`template_xq7yzzb`) rather than requiring 3 new
EmailJS templates to be created in the EmailJS dashboard — consistent with
the existing "template body must contain only `{{{html_message}}}`"
convention, so no EmailJS dashboard changes were needed or made.
