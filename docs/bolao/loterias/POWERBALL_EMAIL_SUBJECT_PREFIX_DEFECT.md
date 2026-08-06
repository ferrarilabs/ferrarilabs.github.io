# Powerball Email — Pending Defect: EmailJS Static Subject Prefix

**Status**: open, non-blocking (accepted exception for the 2026-08-05 real
send per Eduardo's explicit authorization). Tracked here for follow-up —
does not require any new send to investigate further.

## Symptom

Every email sent through EmailJS template `template_xq7yzzb` arrives with a
static `"Bolão do Ferrari - "` prefix prepended to the subject this codebase
sends — including after Eduardo edited the dashboard's Subject field to
`{{entry_name}}` on 2026-08-05.

## Configuration involved

| Field | Value |
|---|---|
| templateId used by **all** flows (participant-added, tickets-published, tickets-corrected) | `template_xq7yzzb` |
| Other template defined in `js/config.js`, never used by this pipeline | `adminTemplateId: "template_4sgp5r9"` |
| serviceId | `service_o4hyzxr` |
| publicKey (masked) | `GBZFu...v0fG5` |
| Relevant code | `bolao/loterias/powerball/scripts/email/send.mjs` (transmits the subject under `entry_name`, `receipt_code`, and `email_subject` — all three set to the same value, since this codebase cannot read which one the dashboard Subject field actually references), `js/config.js` (declares both template IDs), `scripts/send_result_email.py` (unrelated legacy script confirmed to use the same `entry_name`/`receipt_code` pattern successfully in the past) |

## Subjects sent by code vs. subjects actually received

Every row below was verified against the real delivered Gmail message (not
assumed from `providerStatus:200`) in this session.

| Sent by code | Actually received (Gmail) | Gmail message ID | Timestamp (UTC) |
|---|---|---|---|
| `[TESTE ADMIN] ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET` | `Bolão do Ferrari - [TESTE ADMIN] ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET` | `19fd25b276715342` | 2026-08-05T14:36:56Z |
| `[TESTE ADMIN] 🎟️ Bilhetes publicados — Powerball de 05.08.2026 22:59 ET — 2 jogos` | `Bolão do Ferrari - [TESTE ADMIN] 🎟️ Bilhetes publicados — Powerball de 05.08.2026 22:59 ET — 2 jogos` | `19fd265c89deca09` | 2026-08-05T14:48:33Z |
| `[TESTE ADMIN] ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET` (post dashboard-edit re-check #1) | `Bolão do Ferrari - [TESTE ADMIN] ✅ Participação confirmada — ...` | `19fd429802174c99` | 2026-08-05T23:01:57Z |
| Same (post dashboard-edit re-check #2) | `Bolão do Ferrari - [TESTE ADMIN] ✅ Participação confirmada — ...` | `19fd42bfc2ccc4f9` | 2026-08-05T23:04:40Z |
| `✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET [TESTE ADMIN]` (final pre-real-send test, production subject format) | `Bolão do Ferrari - ✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET [TESTE ADMIN]` | `19fd432e4fe5050b` | 2026-08-05T23:12:12Z |
| `✅ Participação confirmada — Bolão Powerball — Sorteio de 05.08.2026 22:59 ET` (real send, e.g. to Alan Rech) | `Bolão do Ferrari - ✅ Participação confirmada — ...` | `19fd43389b3248a1` | 2026-08-05T23:12:55Z |

All 13 real sends on 2026-08-05 carry the same prefix (spot-checked 2 of 13
directly; the pattern is consistent across every diagnostic and real send in
this session — no exceptions observed).

## What this codebase has ruled out

- No occurrence of the literal string `"Bolão do Ferrari"` exists anywhere
  in `bolao/loterias/powerball/scripts/email/` (grepped the full
  directory) — this text is not produced by any code path in this
  pipeline.
- The subject value computed by `renderParticipantConfirmationSubject`/
  `renderTicketPublicationSubject` and passed to `sendEmailJob()` never
  contains the prefix at any point before the HTTP request to EmailJS.
- Three different template variable names (`entry_name`, `receipt_code`,
  `email_subject`) all carry the identical, correct value — ruling out a
  variable-name mismatch as the (sole) cause, since at least one of them
  would be expected to work if the issue were purely "wrong variable name."

## Best-guess likely cause (unconfirmed — this codebase has no EmailJS dashboard credential to verify directly)

Most likely, in rough order of probability:

1. **Account/workspace-level subject template.** Some EmailJS
   plans/accounts support a subject prefix or wrapper configured above the
   per-template level (e.g. an account default or a "branding" setting)
   that would override or prepend to any individual template's Subject
   field, regardless of what that field is edited to. If this is the case,
   no per-template edit — including the one Eduardo already made — can
   remove it; it would need to be found in EmailJS account/workspace
   settings, not the template editor.
2. **Edit applied to the wrong template.** `js/config.js` defines two
   template IDs (`template_xq7yzzb` and `template_4sgp5r9`); if a similarly
   named or duplicate template exists in the dashboard and the edit landed
   there instead of `template_xq7yzzb` specifically, the live template
   would still show the old static prefix.
3. **Edit didn't save**, or EmailJS's edge/cache layer hasn't propagated
   the change yet (less likely given the elapsed time between the edit and
   the most recent re-checks in this session, but not ruled out).

## Next steps for Eduardo (only he can do these — no dashboard access exists in this codebase or environment)

1. Re-open `template_xq7yzzb` specifically (verify the template ID in the
   URL/template list matches exactly) and confirm the Subject field reads
   only `{{entry_name}}` with no other text, then save again.
2. Check EmailJS account/workspace-level settings (not the template editor)
   for any global subject prefix, branding, or default-subject setting.
3. If both of the above look correct and the prefix still appears, contact
   EmailJS support directly, referencing the Gmail message IDs and
   timestamps in the table above as evidence of the discrepancy between
   what was sent via their API and what was delivered.

## Impact

Cosmetic only. The intended subject text always follows the prefix exactly
as rendered — no participant-facing content, financial figures, ticket
numbers, or links are affected. Accepted as a known issue for the
2026-08-05 real send per Eduardo's explicit authorization; not a blocker for
future sends unless he decides otherwise.
