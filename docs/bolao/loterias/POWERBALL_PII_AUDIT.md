# Powerball — PII / Privacy Audit

Scope: `bolao/loterias/powerball/` per Eduardo's Part 2 request. This is an
audit and design-proposal document — no data was moved, redacted, or deleted
in this pass; see "Actions taken in this branch" at the bottom for the one
thing actually changed (wording in the review package manifest).

## 0. Governing clarification from Eduardo

Real participant names/data appearing in **private** review screenshots
(shared only via `~/Desktop/powerball-email-review/`, never committed, never
public) is fine. The actual problem is (a) hardcoded PII in files that reach
a **public** surface, and (b) mislabeling what private evidence contains.
This audit follows that distinction throughout.

## 1. Repository visibility (critical context)

`gh repo view ferrarilabs/ferrarilabs.github.io` → **`visibility: PUBLIC`,
isPrivate: false.** This is the GitHub Pages source repo — `main` is served
directly as the live site, and because the repo is public, **every commit,
every branch, and every file in git history is also readable by anyone** via
github.com (blob view, commit diffs, `raw.githubusercontent.com`), not only
the current working tree of whichever branch happens to be deployed.

## 2. Live, current exposure (not just history)

`bolao/loterias/powerball/index.html` loads `js/data.js` directly as a
`<script src="js/data.js?v=...">` — a plain static file with no server-side
filtering. **Today, right now, on the public site**, `js/data.js` contains,
per participant, in plaintext: `name, cotas, valor, metodo, data, hora, txId,
status, state, email`. Confirmed by grep against the file that ships with
`index.html`:

```
email: "REDACTED_EMAIL"
email: "REDACTED_EMAIL"
...
txId: "REDACTED_PAYMENT_REFERENCE"
txId: "REDACTED_PAYMENT_REFERENCE"
...
```

This means every participant's email address and payment transaction ID
(Zelle/Cash App/Venmo confirmation numbers) is currently downloadable by
anyone who visits the page and views `js/data.js` — this is **not** a
git-history-only issue.

## 3. Git history exposure

- `js/data.js` was introduced in commit `87c9f40` (2026-08-01) and has been
  modified in 46+ commits since, most of which added or changed participant
  emails/txIds.
- An old, superseded personal email (`REDACTED_EMAIL`, later replaced
  by `REDACTED_EMAIL` for the same participant in commit `65c3327`)
  remains in history — anyone who checks out an earlier commit, or views that
  commit's diff on github.com, can still see it, even though it no longer
  appears in the current file.
- `bolao/loterias/powerball/logs/send_result_email_20260804_172718.log` is
  **tracked in git** (present as of the merge commit `4563469`) despite
  `.gitignore` having a `bolao/loterias/*/logs/` rule — the rule only
  prevents *new* untracked files from being added, it does not retroactively
  untrack a file already committed before the rule existed. Content checked:
  this specific log is benign (just start/complete markers, no PII), but the
  pattern (logs committed despite being nominally gitignored) is a latent
  risk if a future log captures participant data.
- No `service_role` Supabase key found anywhere in the repo — only the anon
  (publishable) key, consistent with the platform-wide rule.

## 4. Field-by-field classification

| Field | Where it lives today | Classification | Currently public? |
|---|---|---|---|
| `name` | `js/data.js`, public page table | PÚBLICO PARA O GRUPO | Yes — by design (documented decision below) |
| `cotas` | `js/data.js`, public page table | PÚBLICO PARA O GRUPO | Yes — by design |
| `valor` | `js/data.js`, public page table | PÚBLICO PARA O GRUPO | Yes — by design |
| `status` (verificado/organizador) | `js/data.js`, public page table | PÚBLICO PARA O GRUPO | Yes — by design |
| `data`/`hora` (entry timestamp) | `js/data.js`, public page table | PÚBLICO PARA O GRUPO | Yes — by design |
| `state` | `js/data.js`, public page table (shown as "(NC)" suffix) | PRIVADO DO PARTICIPANTE, currently treated as public | **Yes — should be reviewed**, see below |
| `email` | `js/data.js` only (not rendered in the DOM by `app.js`, but the source file itself is fetched by the browser) | PRIVADO DO PARTICIPANTE | **Yes, via the raw file** — should never have been hardcoded here |
| `txId` (transaction ID) | `js/data.js` only (not rendered in the DOM) | ADMIN-ONLY / financial reference | **Yes, via the raw file** — should never have been hardcoded here |
| `metodo` (payment method: "Zelle", "Cash App"...) | `js/data.js`, public page table | PRIVADO DO PARTICIPANTE (reveals which payment app they use) | Yes — should be reviewed, lower severity than email/txId |
| EmailJS `publicKey`/`serviceId`/template IDs | `js/config.js` | Not a secret by EmailJS's own design (public key is meant to be client-side) — SEGREDO tier does not apply | Yes, intentionally |
| Supabase anon key | `scripts/*.py` | Not a secret by Supabase's own design (anon key + RLS is the intended public-safe pattern) — SEGREDO tier does not apply *if RLS is correctly configured* | Yes, intentionally (RLS enforcement not verified in this pass — flagged as follow-up) |
| Admin password hash | Not found in this app (Powerball has no admin auth layer, unlike Copa/BR2026/CDB2026) | N/A | N/A |

## 5. Existing design decision (documented, not silently changed)

Per what this session found earlier building the email flows: the Powerball
page's public participant table already shows `name`, `cotas`, `valor`,
`metodo`, `data/hora`, and `status` to anyone who visits the page — this
appears to be a **conscious design choice** for a small trusted-group pool
(similar to how Copa2026/BR2026/CDB2026 show participant names in their
public rankings). This audit does not change that decision. What it flags as
a problem is specifically `email`, `txId`, and arguably `state`/`metodo`
riding along in the same public file for no functional reason — the public
page's own rendering code (`js/app.js`) never reads `participant.email` or
`participant.txId`, so their presence in the publicly-served `data.js` is
pure incidental exposure, not a rendering requirement.

## 6. What must never be hardcoded in the static public frontend

Per this audit: `email`, `txId`/transaction/payment reference, phone,
address, banking data, any auth tokens or credentials, and send/audit logs
containing the above. `name`/`cotas`/`status` **can** stay public per the
existing conscious design (§5) — this audit does not recommend changing that
without Eduardo's separate sign-off, since it's a product decision, not a
security bug.

## 7. Email templates from Part 1 — cross-check against this audit

Confirmed by re-reading `scripts/email/render.mjs` and `scripts/email/payload.mjs`:

- **No other participant's data in an individual email**: `buildParticipantConfirmationPayload` and the `perRecipient` mapping in `buildTicketPublicationPayload` only ever embed the single named participant's `individualParticipation` — covered by round-1's automated test ("payload never includes other participants' data") and unchanged in round 2.
- **`txId` never appears in any email template.** Grepped `render.mjs` — no reference to `txId` anywhere in either template's HTML or text output. Covered by the existing test "payload contains no transaction id / banking details" (`audit_email_tests.mjs`).
- **`providerMessageId` never appears in an email body** — it's an outbox-only field (`scripts/email/outbox.json`), never passed into `render.mjs`.
- The publication/correction emails' shared "Resumo geral do bolão" section intentionally aggregates counts (`participantCount`, `totalShares`) — never a list of other participants' names/emails/amounts.

## 8. Cleanup plan for git history (PROPOSAL ONLY — not executed)

**Not executed in this branch.** Presented for Eduardo's approval before any
history rewrite is performed.

- **Tooling**: `git filter-repo` (BFG is unmaintained and slower for
  path+content replacement; `filter-repo` is the currently recommended tool
  and is explicitly endorsed by GitHub for this use case).
- **Target**: strip `email:` and `txId:` values from every historical
  revision of `bolao/loterias/powerball/js/data.js` (and any other file found
  to carry them), replacing with a placeholder (e.g. `"[redacted]"`), not
  deleting the file (deleting would break `--follow` history and any
  external links to specific commits).
- **Impact**:
  - Every commit hash from `87c9f40` (2026-08-01) onward that touched
    `data.js` will be **rewritten** — all downstream commit hashes change.
    This branch (`powerball-email-professionalization`) and any other open
    branch would need to be rebased onto the rewritten history or recreated.
  - Anyone with an existing local clone (including Eduardo's own machines)
    must re-clone or hard-reset to the rewritten history — old clones will
    diverge and silently retain the old (unredacted) history unless
    replaced.
  - The `powerball-email-review.bundle` produced in round 1 (and this
    round's updated package) was bundled against the **old** commit hashes;
    after a history rewrite it would need to be regenerated.
  - GitHub Pages itself: once force-pushed, GitHub's CDN cache for the
    previously-published pages content would eventually expire, but the
    **old commit objects remain fetchable from GitHub's server-side caches
    and any forks/clones for some period** — a filter-repo rewrite reduces
    exposure going forward but cannot guarantee historical blobs are
    unreachable everywhere (forks, cached CI artifacts, third-party clones,
    web archives that may have crawled raw file URLs).
  - Because this is the *GitHub Pages source repo itself*, a force-push to
    `main` mid-rewrite would briefly break the live site if not sequenced
    carefully (recommend doing the rewrite in a private mirror first, then
    a single coordinated force-push).
- **Recommended sequence** (once approved): (1) mirror-clone the repo
  privately, (2) run `filter-repo` against the mirror, (3) verify the
  rewritten history builds and serves correctly from a local server, (4)
  coordinate a maintenance window, (5) force-push to `origin/main` and all
  other branches that need it, (6) ask every machine with a clone to
  re-clone, (7) regenerate any previously-issued bundles/zips.
- Given the field is *already public* on the live site regardless of git
  history (§2), the higher-priority fix is stopping the ongoing exposure
  (§9), not the history rewrite — history cleanup reduces the retrospective
  footprint but does not, by itself, stop today's exposure.

## 9. Proposed central persistence migration (PROPOSAL / DESIGN ONLY — not implemented)

**Not implemented in this branch — this is out of scope for the email-fix
work and requires Eduardo's separate go-ahead.** Minimal table model:

```
lottery_participants   (id, pool_id, display_name, state, created_at)
lottery_payments       (id, participant_id, amount, method, tx_reference, status, paid_at)   -- ADMIN-ONLY
lottery_draws          (id, pool_id, draw_date, jackpot, cash_value, status)
lottery_tickets        (id, draw_id, numbers, special, serial, publication_version)
lottery_results        (id, draw_id, numbers, special, multiplier, checked_at)
lottery_email_jobs     (id, pool_id, draw_id, participant_id, event_type, recipient,
                         template_id, template_version, payload_snapshot, idempotency_key,
                         status, provider_message_id, sent_at)                              -- ADMIN-ONLY, no email/tx in provider_message_id
lottery_admin_audit    (id, actor, action, target_table, target_id, before, after, at)       -- ADMIN-ONLY, protected
```

Public projection (what an anonymous visitor to the page can read) would be
a view/RLS policy exposing **only**: `displayName, shares, amountConsidered,
participationStatus, publicPaymentStatus` — never `email`, `tx_reference`,
`payment_reference`, `phone`, `internal_notes`, or `provider_message_id`.

Access model: RLS deny-by-default; anonymous role gets `SELECT` on the public
view only, never `INSERT`/`UPDATE`/`DELETE`; all writes go through an
authenticated admin role; `lottery_admin_audit` readable only by that admin
role; no `service_role` key ever shipped to the browser (matches the
platform-wide rule already in `CLAUDE.md`).

This would fully solve §2's live exposure (no more hardcoded per-participant
file shipped to the browser) but is a genuinely separate, larger project —
flagged here as a recommendation, not started.

## 10. Individual participant data — collective vs. individual view

Confirmed (§7): estado, lump sum/annuity estimate, percentual, and payment
status appear **only** in the individual's own confirmation/publication
email — never in a collective view. Powerball currently has **no
authenticated participant-only web area** and **no admin web UI** (see
`POWERBALL_EMAIL_ARCHITECTURE.md`), so "Admin view" in Eduardo's framing
currently means "Eduardo's own terminal running the CLI scripts against
`js/data.js`/Supabase" — there is no browser-based admin surface that could
leak this data today.

## 11. Private evidence handling

- `~/Desktop/powerball-email-review/` is outside the repository working tree
  (`git check-ignore` confirms it is not even inside the git worktree, let
  alone tracked) — nothing from it can be accidentally committed by a normal
  `git add`.
- Nothing under `email-previews/` in this repo contains real participant
  data — every preview in this round is built from the synthetic fixture
  (`scripts/email/fixtures/powerball-email-test-fixture.json`), not real
  `js/data.js` records, specifically so these files are safe to commit.
- The round-1 package manifest's wording claiming "synthetic data only" is
  corrected in this round (see §12) to accurately describe what any *real*
  screenshots taken from `js/data.js` in a future session would contain, in
  case Eduardo asks for a real-data preview later.

## 12. Manifest wording fix

`~/Desktop/powerball-email-review/powerball-email-review-manifest.txt` is
regenerated as part of this round's repackaging step with corrected wording:
it no longer claims screenshots contain only synthetic "Participante
Alfa/Beta" data as a blanket statement about the whole package, and instead
states plainly that **this round's** previews are 100% synthetic-fixture
data (true, and verifiable — every preview file is generated by
`scripts/email/generate_previews.mjs` from the fixture, not from
`js/data.js`), while adding the general disclosure that any future private
captures in that directory may contain real names/operational data and must
never be published or shared publicly.

## Gate checklist (Eduardo's Part 2 gate)

- PII hardcoded no frontend público = **currently 15 emails + 28 txIds
  present in the live `js/data.js`** — NOT zero. Flagged, not fixed in this
  branch (fixing requires either the persistence migration in §9 or, as a
  smaller interim step, moving `email`/`txId` out of `data.js` into a
  separate non-served file — **not done here, needs Eduardo's explicit
  go-ahead since it changes the existing add-participant scripts' data
  shape**).
- Transaction IDs públicos = same as above, NOT zero, flagged.
- E-mails públicos = same as above, NOT zero, flagged.
- Segredos no frontend = **zero** — only the EmailJS public key and Supabase
  anon key, both intentionally public-safe by their own provider's design.
- Dados reais em evidência privada controlada = permitido, and confirmed
  nothing real leaked into this repo or its previews this round.
- Manifesto descreve os dados honestamente = fixed this round (§12).

## Actions taken in this branch (Part 2)

1. This document.
2. `powerball-email-review-manifest.txt` wording fix (regenerated with the
   packaging step below).
3. No code, no data, no git history changed. No migration applied. No
   PII removed from `js/data.js` — that requires Eduardo's explicit
   go-ahead per the scope note above.
