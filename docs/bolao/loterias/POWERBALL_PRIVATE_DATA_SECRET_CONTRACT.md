# POWERBALL_PRIVATE_PARTICIPANT_DATA — secret contract

Status note: this secret was already created and twice updated on
`ferrarilabs/ferrarilabs.github.io` in the prior work session, **before** this
gate ("não criar ou atualizar o secret sem validar o contrato primeiro") was
requested. It is not undone here — GitHub secrets can't be diffed/rolled back
short of overwriting or deleting them, and doing either without a validated
contract would itself be an uncontrolled change. This document is that
contract, written retroactively, and **no further create/update of the secret
happens in this pass** — only this documentation and the code that reads it.

## TARGET_STATE / TRANSITIONAL_STATE / PUBLIC_STATIC_SOURCE

```
TARGET_STATE       = Supabase, protected by RLS, participant email resolved
                      server-side (or via an authenticated admin call) —
                      never shipped to the browser, never embedded in a
                      committed file.
TRANSITIONAL_STATE = GitHub Actions encrypted repository secret
                      (POWERBALL_PRIVATE_PARTICIPANT_DATA), injected as an
                      env var into CI jobs and read from a gitignored local
                      sidecar file for manual/local runs. This is where we
                      are today.
PUBLIC_STATIC_SOURCE = PROHIBITED. js/data.js (or any other file served by
                      GitHub Pages) must never carry participant email, txId,
                      phone, or any other private field again.
```

## JSON format

```json
{
  "<drawId>": {
    "<participant name, exact string match to data.js's \"name\" field>": {
      "email": "string",
      "txId": "SYNTH000042"—\""
    }
  },
  "_overrides": {
    "<participant name>": "<email to route to instead — e.g. a household member's inbox>"
  }
}
```

- Top-level keys are draw IDs (e.g. `"2026-08-05"`), matching `js/data.js`'s
  `draws[].id` exactly.
- `_overrides` is a single flat map, draw-independent, for cases like "Tatiana
  Bossle's confirmation goes to Gustavo's inbox" — applied after the per-draw
  lookup, same behavior as the old hardcoded `PARTICIPANT_EMAIL_OVERRIDES`.

## Matching key — known limitation

**Matching key is currently participant `name` (exact string match), not a
stable participant ID.** This is a real limitation, not a design endorsement:

- Two participants with the same display name in the same draw would
  collide (last one in the private JSON wins, silently).
- A typo or renaming in `data.js` (e.g. adding a middle name) silently
  breaks the match — the participant then falls into "email not found"
  (see below), not a wrong-recipient send, so the failure mode is safe
  (no email) rather than unsafe (wrong email) — but it does mean a
  legitimate participant can silently not receive their email if the two
  files drift.
- **Not fixed in this pass.** The real fix is a stable `participantId` in
  both `data.js` and the private JSON — deferred to the Supabase target
  state, where `user_id`/`participation_id` already exist as real primary
  keys. Documented here as accepted residual risk for the transitional
  state, not silently ignored.
- **P0.2 mitigation added**: both `send_result_email.py`
  (`_normalize_name`/collision check in `load_participants_from_private_env`)
  and `scripts/email/snapshot.mjs` (`normalizeName`/collision check in
  `resolvedPrivateDrawMap`) now (a) normalize names deterministically (trim,
  collapse whitespace, casefold) before matching, and (b) detect when two
  distinct raw names in the same draw's private data normalize to the same
  key — if that happens, private fields are refused for that entire draw
  (fail closed), never guessed. Log lines use a short non-reversible hash of
  the colliding key, never the raw name. Covered by
  `test_send_result_email_gating.py` (tests 7-8) and
  `test_private_data_contract.mjs` (test 6).

```
MATCHING_MODEL   = TRANSITIONAL_NAME_BASED
TARGET_MODEL     = STABLE_PARTICIPANT_ID_FROM_PRIVATE_DATABASE
RISK_ACCEPTANCE  = TEMPORARY
EXPIRATION       = when the Supabase target state (see "Replacing this with
                    Supabase" below) becomes the primary path AND its anon-key
                    401 bug is fixed — no calendar date set; tracked as an
                    open item in the incident record, not left undated
                    silently. Re-review this contract if it's still the
                    transitional state past the 2026-08-08 draw's payout.
```

## Behavior contracts

| Situation | Behavior |
|---|---|
| Secret/env var absent | `load_participants_from_private_env` (Python) / `loadPrivateParticipantData` (mjs) return `{}` for that source; the caller logs a warning and returns zero participants for anyone who needed the private-fallback path. **Never** falls back to reading `data.js`'s (now-absent) email field. |
| JSON invalid | Caught in a `try/except` (Python) / `try/catch` (mjs); logged, treated as empty (`{}`), never crashes with a partial-parsed/undefined-behavior state. The raw invalid JSON string is never echoed into the log/exception message. |
| Participant not found in private data | That participant is skipped (`email not found` warning printed, no address), not silently dropped without a trace — same as the old `data.js`-fallback behavior for participants with `email: "—"`. |
| Invalid email format | Existing `validate.mjs` / `send_result_email.py`'s email-format checks still run on whatever value comes out of the private-data merge — an invalid string doesn't bypass validation just because it came from the secret instead of `data.js`. |
| Duplicate name → duplicate email | Both code paths already de-duplicate by **email**, not name (`seen_emails` set) — a name collision producing the same email sends once; a name collision producing two different emails is the "matching key" risk above, not separately guarded yet. |

## Required send-gating behavior (not yet fully implemented — see below)

The user's gate requires: **fail before sending, not partway through, if any
required recipient is unresolved; never report "send complete" if any
recipient is unresolved.**

Current state: `send_result_email.py --send-all` already collects
`missing_emails` from the loaded participant list and refuses to proceed if
any exist (`validate_draw_data()`, existing code, unmodified by this hotfix).
This behavior is preserved by the private-data change — it operates on
whatever participant list comes back, private-data-backed or Supabase-backed,
identically. **Not independently re-verified end-to-end in this pass** (would
require a real send or a very deep mock) — flagged as a P0.2/regression-test
follow-up, not asserted as proven here.

## txId is mandatory for every real payment (Eduardo, 2026-08-09)

`txId` (the Zelle/Venmo/Cash App transaction number, or the platform's
equivalent) is not optional metadata — it is the audit trail that proves a
recorded payment actually happened. Every real participant payment
registered in the sidecar (or the secret) must carry its real `txId`, taken
from the actual confirmation email/notification, not a placeholder.

This was a real gap: `add-participant.js` and `add_participants.py` used to
hardcode `txId: "—"` for every participant they added, with no way to pass a
real one in — so anyone using the "official" CLI path would silently lose
the audit trail even when a real payment existed. Both scripts now accept
`--tx-id` (single entry) or a `txId` CSV column (batch), and warn loudly if a
participant is saved without one. `"—"` remains valid only for participants
with no real payment yet (self-funded/organizer/"Saldo anterior" carry-over)
— never as a stand-in for "didn't bother to look up the real number."

## Not automated in this pass

"No unexpected extra recipient" (a name present in the private data but not
in that draw's real `js/data.js` participant list) is **not** automatically
checked — doing so would require the loader to diff against the public
participant list at load time, which isn't wired up yet. Today this is an
operator responsibility when populating the secret. Flagged here rather than
silently assumed solved.

## Secrecy hygiene

- Never printed to stdout/stderr by any code in this hotfix — confirmed by
  grep: no `print(...POWERBALL_PRIVATE...)`, no `console.log(...raw...)`
  anywhere in the changed files (see FUNCTIONAL_REGRESSION section of the
  P0.1 report for the actual command run).
- Never included in an exception message — the `except` blocks in both
  `load_participants_from_private_env` and `loadPrivateParticipantData` catch
  generically (`except Exception as e` / `catch {}`) and log only `e`'s own
  message (a JSON parse error's own text, e.g. "Unexpected token"), never the
  input string itself.
- No `set -x` (or equivalent shell tracing) anywhere in
  `.github/workflows/powerball-results-email.yml` — confirmed by reading the
  workflow file in full.
- Not written to any persistent file inside the GitHub Actions runner — it
  exists only as `env:` in the one step that needs it, in that step's process
  environment, never redirected to a file. No `mktemp` is currently needed
  because nothing in this pipeline writes it to disk in CI (only the local
  manual sidecar file does, and that one is gitignored + explicitly for local
  use, never CI).
- Local manual runs use `scripts/private-participant-data.local.json`
  (gitignored) rather than the env var — this file is never generated inside
  CI, only by a human running `add-participant.js`/`add_participants.py`
  locally.

## Rotation

To rotate (e.g. after a participant asks to be removed, or a suspected
exposure): `gh secret set POWERBALL_PRIVATE_PARTICIPANT_DATA --repo
ferrarilabs/ferrarilabs.github.io < new-file.json`, then verify with `gh
secret list` (shows update timestamp, never the value). Old value is
unrecoverable once overwritten — GitHub does not version secret values.

## Replacing this with Supabase (future)

When the Supabase target state lands: `load_participants_from_supabase`
already exists and is tried **first** in `send_result_email.py` — the private
secret is already wired as the fallback-only path. Migrating fully means (1)
populating `public.users.email` for all real participants, (2) fixing the
currently-broken `SUPABASE_ANON_KEY` in this script (see its own comment: the
key returns HTTP 401 today — a pre-existing bug, not introduced by this
hotfix, tracked separately), (3) once the primary path reliably succeeds, the
secret becomes true dead-code fallback and can eventually be deleted and the
private sidecar mechanism retired from `add-participant.js`/`add_participants.py`.
