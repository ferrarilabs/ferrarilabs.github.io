# Powerball Email — Operations Runbook

Status as of 2026-08-05: **Flow A (participant confirmation) activated for a
one-time authorized backfill** — 13 real participants of draw `2026-08-05`
were sent their confirmation email (see "2026-08-05 backfill send" below).
Flow B (ticket publication) remains NOT activated — no real publish has been
performed, and the production attachment/link gate currently blocks it by
design (no attachment pipeline wired up yet).

## PENDING DEFECT — EmailJS static subject prefix (not blocking, tracked)

**Symptom**: every email sent through EmailJS template `template_xq7yzzb`
arrives with a static `"Bolão do Ferrari - "` prefix prepended to the
subject this codebase sends, even after Eduardo edited the dashboard's
Subject field to `{{entry_name}}` on 2026-08-05.

- **templateId**: `template_xq7yzzb` (the only template this pipeline ever
  uses, for all three flows — participant-added, tickets-published,
  tickets-corrected). `js/config.js`'s other template,
  `adminTemplateId: "template_4sgp5r9"`, is never referenced by this
  pipeline.
- **serviceId**: `service_o4hyzxr`.
- **publicKey (masked)**: `GBZFu...v0fG5`.
- **Tests performed**: multiple fresh diagnostic sends across several
  rounds, each immediately cross-checked against the actual delivered Gmail
  message (not assumed from `providerStatus:200`).
- **Subjects sent vs. received** (representative sample, most recent
  checks):
  - Sent: `[TESTE ADMIN] ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET`
    Received (Gmail msg `19fd429802174c99`, 2026-08-05T23:01:57Z): `Bolão do Ferrari - [TESTE ADMIN] ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET`
  - Sent (after Eduardo's dashboard edit, re-verified): same pattern —
    Received (Gmail msg `19fd42bfc2ccc4f9`, 2026-08-05T23:04:40Z): still prefixed.
  - Sent (final pre-real-send test): `✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET [TESTE ADMIN]`
    Received (Gmail msg `19fd432e4fe5050b`, 2026-08-05T23:12:12Z): `Bolão do Ferrari - ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET [TESTE ADMIN]`
  - Real sends (13, 2026-08-05T23:12–23:13Z) all carry the same prefix per
    spot-check (Gmail msg `19fd43389b3248a1`, to Alan Rech).
- **Best-guess likely cause** (cannot be confirmed without dashboard
  access, which this codebase does not have): either (a) the edit was
  applied to a different template than `template_xq7yzzb` (e.g. a
  duplicate/staging copy, or `template_4sgp5r9` by mistake), (b) the edit
  didn't save, or (c) EmailJS account/workspace-level subject prefixing
  (some EmailJS plans/settings apply an account-wide subject template
  wrapper independent of the per-template Subject field) — this last
  possibility would mean no per-template dashboard edit can remove it, and
  it would need to be checked in EmailJS's account-level settings, not the
  template editor.
- **Status**: accepted as a known, non-blocking cosmetic defect for the
  2026-08-05 send per Eduardo's explicit authorization. Not fixed in this
  codebase because there is nothing in this codebase producing that text —
  confirmed by grepping the entire `scripts/email/` directory for the
  string `"Bolão do Ferrari"` (zero matches outside this doc).
- **Next step**: Eduardo to check EmailJS account-level subject settings (not
  just the template editor) for `template_xq7yzzb`, or contact EmailJS
  support with the message IDs above as evidence of the discrepancy.

## 2026-08-05 backfill send — record

Explicit literal authorization ("APROVADO") relayed from Eduardo via the
coordinator. Script: `scripts/email/send_participant_confirmation_backfill.mjs`
(new, one-time-use — sends to every current eligible participant of a draw
who hasn't received a confirmation yet, not the per-add trigger).

- Draw: `2026-08-05`.
- Financial reconciliation (real data, computed at send time):
  `totalArrecadado` $148.00 + `creditoSorteioAnterior` $16.00 = `totalPaid`
  $164.00; `totalSpent` (valorUtilizado) $162.00 + `remainingBalance`
  (valorGuardadoProximoSorteio) $2.00 = $164.00. **Difference: $0.00 exactly.**
  Also confirmed: sum of all 15 participants' individual `valor` fields
  ($148.00) matches `totalArrecadado` exactly — no inconsistent amounts.
- Eligibility: 15 total participants → 13 eligible, 2 excluded
  (`Jorge Augusto Junqueira Ferreira`, `Marcelo Minghetti Pereira` — both
  `INVALID_EMAIL`, literal `"—"` in `js/data.js`). Zero duplicate emails,
  zero duplicate participant names, zero state-unsupported blocks among the
  13 eligible (all NC or FL).
- Pre-send verification: one full production-shaped test to
  `emferrari@gmail.com` (real participant data — Gustavo Bossle's record —
  production subject + `[TESTE ADMIN]` appended, production HTML with no
  test banner) was sent and its actual delivered content fetched from Gmail
  and inspected line-by-line: correct name, cotas ("1 cota de 15 cotas"),
  values, dates (friendly + technical), jackpot ($786,000,000.00), cash
  option, lump sum, annuity, and a real `https://ferrarilabs.github.io/...`
  link — no placeholders, no localhost. Only defect: the accepted
  "Bolão do Ferrari - " prefix (see above).
- Real send: 13 individual EmailJS calls (one recipient per call, no CC, no
  batch/collective recipient), 1200ms throttle between sends,
  `providerStatus:200` / `ok:true` for all 13, 0 failures, 0 retries needed.
  Ledger written immediately after each send to
  `~/Desktop/powerball-confirmation-send-2026-08-05.json` (private, outside
  the git working tree, never committed — verified via `git check-ignore`
  reporting the path as outside the repository entirely).
- Idempotency key pattern used:
  `powerball:participant-confirmation-backfill:v1:{participantId}` — a
  second run of this script for the same draw will skip everyone already
  marked `"sent"` in that ledger file.
- Spot-checked 2 of the 13 real deliveries directly in Gmail (Gustavo
  Bossle's full body content, Alan Rech's subject/recipient) — both correct
  except for the accepted prefix.

## Prior status (pre-backfill)

Everything below describes the general architecture; the "not activated"
framing for Flow A is now superseded by the 2026-08-05 backfill above.

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
