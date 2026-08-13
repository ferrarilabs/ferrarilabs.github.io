<!-- FDC-20260813 · decision D-A · sanitized: the address itself is never reproduced -->
# OPERATOR EMAIL USAGE AUDIT — decision D-A

**55 occurrences across 30 files** at `origin/main` `23baf6b1`. One address, the operator's own,
which is also one of the 24 production participant addresses. The address is not printed here.

## 1. The two measurements that decide everything

**It is not a security boundary.** `adminEmail` is never compared, anywhere:
`grep -E '==\s*(C|CONFIG|config)\.adminEmail|\.adminEmail\s*==='` over every `.js` at HEAD
returns **zero** matches. Its only uses are `to_email:` in an EmailJS payload. The admin boundary
is `adminPasswordHash`, a SHA-256 digest, which is a different field entirely.

**It is not on the published site.** It appears in **0** `.html` files, and fetching
`https://www.ferrarilabs.com/` and `https://ferrarilabs.github.io/` returns **0** occurrences in
the delivered HTML. The site's contact path is the Formspree form. The allowlist comment in
`scripts/pii_detectors.mjs` asserted the opposite — "on every language version of the site" — and
that comment has been corrected in this branch. It was allowlisted for the right decision and the
wrong reason.

So the exposure is precisely: **a public repository, not a published page**, and **a routing
value, not a credential**.

## 2. Classification — every occurrence, no UNKNOWN

| Category | Occurrences | Where |
|---|---:|---|
| `PARTICIPANT_DATA_EMBEDDED_IN_CODE` | **22** | Powerball `scripts/email/outbox.json` ×19 (delivery history), `email-previews/email-test-results.txt` ×1, `docs/AUDIT_LOGGING.md` ×2 |
| `OPERATIONAL_NOTIFICATION_RECIPIENT` | **12** | `adminEmail` in four `js/config.js` (copa2026, br2026, cdb2026, powerball); `ADMIN_EMAIL` in five operator send scripts; default `recipient` in three Powerball `.mjs` senders |
| `PUBLIC_CONTACT_INTENTIONAL` | **5** | `send_bracket_correction_email.py` ×3 (usage docstring + the `Eduardo Ferrari · …` signature rendered in two email templates), `docs/bolao/PROJECT_CONTEXT.md` ("Admin contact"), `docs/bolao/BUGS_AND_FEEDBACK.md` ("report bugs to") |
| `PUBLIC_AUTHOR/OWNER_METADATA_INTENTIONAL` | **5** | the PII-detector allowlists themselves: `scripts/pii_detectors.mjs`, `scripts/test_audit_pii_repo_wide.mjs`, `scripts/audit_email_send_safety.mjs`, `scripts/test_fixture_privacy.mjs`, `bolao/loterias/powerball/scripts/audit_pii_tests.mjs` |
| `DOCUMENTATION_EXAMPLE` | **5** | `POWERBALL_EMAIL_OPERATIONS_RUNBOOK.md` ×2, `POWERBALL_EMAIL_TEST_PLAN.md`, `POWERBALL_PARTICIPANT_CONFIRMATION.md`, `bolao/br2026/CHANGELOG.md` |
| `PRIVILEGED_ADMIN_IDENTIFIER` | **4** | `POWERBALL_ADMIN_OPERATIONS.md` ×2, `POWERBALL_ADMIN_SECURITY.md`, `POWERBALL_DATA_MODEL.md` — the Supabase Auth owner identity for the Powerball admin |
| `TEST_FIXTURE` | **2** | `powerball/scripts/audit_email_tests_round3.mjs` |
| `DEAD_CODE` | **0** | — |
| **`UNKNOWN_EMAIL_USAGE`** | **0** | — |
| **total** | **55** | **30 files** |

## 3. Policy applied, per category — and why nothing was rewritten

| Category | §12 policy | Applied |
|---|---|---|
| `PUBLIC_CONTACT_INTENTIONAL` · `PUBLIC_OWNER_METADATA` | retain if genuinely intentional; document as deliberately public; **do not call it a secret** | **retained.** The allowlists in category 4 *are* the prior decision, written in code before this audit existed. Documented here; the one inaccurate justification corrected |
| `OPERATIONAL_NOTIFICATION_RECIPIENT` | move server-side **where doing so does not create unnecessary complexity** | **retained, with the reason stated.** The three bolão apps are static pages that call EmailJS **from the browser** — there is no server to move it to, and inventing one to hide a non-secret is exactly the complexity the policy excludes. The five Python senders do run server-side in GitHub Actions and *could* read an env var; that is a change to the live result-email path for no security gain, and this session does not touch the money path. **Recommended, not executed** |
| `PRIVILEGED_ADMIN_IDENTIFIER` | must not be a browser-side security boundary; move out of client-facing privileged logic | **verified compliant, no change needed.** All four are prose in Powerball docs naming the Supabase Auth owner. The boundary is enforced server-side by role and RLS; no client-side logic keys off the address (0 comparisons, measured) |
| `PARTICIPANT_DATA_EMBEDDED_IN_CODE` | remove the business datum where possible; preserve privately | **registered, not removed.** `outbox.json` holds exactly **2** distinct addresses: the operator's own and one `example.invalid` — **no third party's data**. It is Powerball's durable delivery ledger, which its tooling reads; deleting it would destroy operational history to hide the operator's own address. Powerball is an adjacent product, out of the bolão retirement scope |
| `TEST_FIXTURE` | replace with a reserved example domain **if that does not change test semantics** | **retained.** Both assert that a specific real historical send went to the operator. Substituting `example.com` would make the assertion false |
| `DOCUMENTATION_EXAMPLE` | replace unless the real contact is intentionally part of the documentation | **retained.** All five document the actual test-mode override target ("real recipient forced to …"). Replacing the value would make the runbooks wrong |

**No secret was committed, and none was found.** The address is a mailbox, not a credential; the
only credential-shaped values nearby are `adminPasswordHash` (a digest, by design) and
`TEST_OWNER_PASSWORD=<the password you set>` (a placeholder, never a value).

## 4. Identity

The mailbox belongs to a real participant. **No identity inference was made and no participant was
merged.** `bolao.participants.canonical_participant_id` remains NULL for all 26 rows and
`participant_identity_links` remains empty. That this address appears both as the operator's
routing target and as a participant's contact is a fact about one person holding two roles, not a
key to join on.

## 5. Status

`D_A_STATUS = CLASSIFIED_AND_DOCUMENTED_NO_REMEDIATION_REQUIRED`

One file changed: `scripts/pii_detectors.mjs`, correcting a stale justification in the allowlist.
The decision it justifies is unchanged and remains correct.

**Standing recommendation for the next time the senders are touched** (not executed here): move
`ADMIN_EMAIL` in the five Python scripts to an environment variable supplied by the workflow. It
removes 5 of 55 occurrences, changes no behaviour, and is safe to do alongside a change that is
already exercising the email path — but not on its own, and not while the result-email cron is the
only thing standing between a finished tournament and its participants.
