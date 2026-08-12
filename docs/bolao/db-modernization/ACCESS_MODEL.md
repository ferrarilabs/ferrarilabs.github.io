<!-- GENERATED FILE — do not edit by hand. Source: model/access_model.json. Regenerate: node scripts/db/validate_access_model.mjs --write -->

# ACCESS_MODEL — target RLS (R) and Edge write contracts (S)

Generated from `model/access_model.json`; enforced by `scripts/db/validate_access_model.mjs`.

Status: **DESIGN ONLY — no policy, grant or function has been created or applied anywhere**

## Stance

DEFAULT DENY. Every entity starts with RLS enabled and zero policies, which in PostgreSQL means nobody can read or write it. Access is then granted only where a named workload needs it. The current production posture is the opposite: six policies that are row ALLOWLISTS with no identity awareness, so authorization effectively lives in browser JavaScript (finding DR-1).

**Principle.** Financial and admin writes are SERVER-MEDIATED. anon may never INSERT, UPDATE or DELETE a payment, allocation, prize or identity link. The reason is not policy elegance: the anon key is public, so a policy permitting anon writes to a money table permits the internet to write to a money table.

**Reads.** Reads that reports need are served through views owned by the service role, not by widening table-level policies. A view can project away email and external_reference; a policy cannot.

## Roles

| Role | Meaning |
|---|---|
| `anon` | the unauthenticated browser, holding the public anon key. Must be assumed hostile: the key is in the page source, so anything anon can do, anyone on the internet can do. |
| `authenticated` | a signed-in Supabase user. Not currently used by the platform; reserved so the model does not have to be redesigned when it is. |
| `operator` | an administrator. Today identified by a client-side password hash, which is NOT an identity the database can verify — see R-GAP-1. |
| `service` | the server runtime (Edge Functions) using the service_role key. Bypasses RLS by design, which is why every service path must be a narrow, audited contract rather than a general-purpose door. |

## Permission matrix

`—` means no access at all. `SELECT_OWN` means SELECT restricted by an identity-aware predicate.

| Table | FORCE RLS | anon | authenticated | operator | service |
|---|---|---|---|---|---|
| `participants` | yes | — | SELECT_OWN | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `participant_identity_links` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `competitions` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `competition_editions` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `competition_edition_phases` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `classification_snapshots` | no | SELECT | SELECT | SELECT | SELECT, INSERT |
| `competition_edition_standings` | no | SELECT | SELECT | SELECT | SELECT, INSERT |
| `pools` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `pool_fee_schedule` | yes | SELECT | SELECT | SELECT | SELECT, INSERT, UPDATE |
| `pool_entries` | yes | — | SELECT_OWN | SELECT, UPDATE | SELECT, INSERT, UPDATE |
| `payments` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `payment_allocations` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `prize_allocations` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `ties` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `matches` | no | SELECT | SELECT | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `match_results` | yes | SELECT | SELECT | SELECT | SELECT, INSERT, UPDATE |
| `predictions` | yes | — | SELECT_OWN | SELECT | SELECT, INSERT, UPDATE |
| `ranking_snapshots` | no | SELECT | SELECT | SELECT | SELECT, INSERT |
| `sync_state` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `audit_events` | yes | — | — | SELECT | SELECT, INSERT |
| `audit_event_details` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `outbox_events` | yes | — | — | SELECT | SELECT, INSERT, UPDATE |
| `outbox_delivery_attempts` | yes | — | — | SELECT | SELECT, INSERT |

## Per-table detail

### `participants`

**No DELETE.** participants are never deleted. A merge supersedes; erasure redacts in place. Deleting one would orphan entries and destroy financial history.

**Notes.** anon gets NOTHING. Today anon can read participant names and emails through bolao_state; closing that is a behaviour change requiring the app to read through a projection instead.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `participants_service_all` | service | SELECT, INSERT, UPDATE | `true` | the write path creates participants when an entry is submitted |
| `participants_self_select` | authenticated | SELECT | `auth.uid() = auth_user_id` | identity-aware self-read; the only participant-facing read that does not leak other people's contact data |

### `participant_identity_links`

**No DELETE.** a link row is retained even after reversal — that a merge happened and was undone is history.

**Notes.** Operator gets SELECT only, NOT INSERT. A merge is an irreversible-by-default money-affecting act and must go through the contract that requires {operatorId, reason}, never a direct row insert.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `identity_links_service_write` | service | SELECT, INSERT, UPDATE | `true` | merges are performed by the server-mediated merge contract, which enforces the operator confirmation |

### `competitions`

**No DELETE.** reference data is retired by a status flag, not deleted; deleting one would orphan every edition.

**Notes.** Genuinely public reference data. No PII, no money.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `competitions_public_read` | anon, authenticated | SELECT | `true` | competition names are public facts and the app renders them before any sign-in — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `competitions_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `competition_editions`

**No DELETE.** retired by status.

**Notes.** Public reference data.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `editions_public_read` | anon, authenticated | SELECT | `true` | same as competitions — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `competition_editions_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `competition_edition_phases`

**No DELETE.** retired by status.

**Notes.** cutoff_at is public on purpose — a hidden deadline is worse than a public one. But the cutoff must ALSO be enforced server-side; today it is client-only and bypassable by clock manipulation (R-GAP-2).

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `phases_public_read` | anon, authenticated | SELECT | `true` | the app must show cutoff times to everyone — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `competition_edition_phases_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `classification_snapshots`

**No DELETE.** DELETE is granted to nobody. A classification snapshot is provider evidence retrieved at an instant that cannot be re-retrieved, and it is exactly what a past round's zone boundaries were computed against; deleting it would erase the basis of scores already published. A correction is a NEW snapshot with a later generated_at, which ordering resolves — so nothing ever needs removing. UPDATE is likewise granted to nobody: the table is append-only.

**Notes.** Public to read, because the provider already publishes this table and the app shows its zones to every visitor. Never writable from a browser: br2026's G4/Z4/SA6 are position slices of these rows, so a forged row moves a relegation boundary and therefore a score. Written only by the sync runtime; an operator correction goes through a named write contract that inserts a new snapshot rather than editing one.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `classification_snapshots_public_read` | anon, authenticated | SELECT | `true` | the league table is already published by the provider and the app renders its zones to every visitor; one policy covering both roles, since a signed-in user must not see less than an anonymous one |
| `classification_snapshots_service_insert` | service | INSERT | `true` | the sync runtime is the only writer. anon and authenticated have no INSERT at all, which is the control that stops a browser establishing official standings — they decide zone boundaries and therefore scores |

### `competition_edition_standings`

**No DELETE.** DELETE is granted to nobody. A classification snapshot is provider evidence retrieved at an instant that cannot be re-retrieved, and it is exactly what a past round's zone boundaries were computed against; deleting it would erase the basis of scores already published. A correction is a NEW snapshot with a later generated_at, which ordering resolves — so nothing ever needs removing. UPDATE is likewise granted to nobody: the table is append-only.

**Notes.** Public to read, because the provider already publishes this table and the app shows its zones to every visitor. Never writable from a browser: br2026's G4/Z4/SA6 are position slices of these rows, so a forged row moves a relegation boundary and therefore a score. Written only by the sync runtime; an operator correction goes through a named write contract that inserts a new snapshot rather than editing one.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `competition_edition_standings_public_read` | anon, authenticated | SELECT | `true` | the league table is already published by the provider and the app renders its zones to every visitor; one policy covering both roles, since a signed-in user must not see less than an anonymous one |
| `competition_edition_standings_service_insert` | service | INSERT | `true` | the sync runtime is the only writer. anon and authenticated have no INSERT at all, which is the control that stops a browser establishing official standings — they decide zone boundaries and therefore scores |

### `pools`

**No DELETE.** a pool with entries can never be deleted; it is closed.

**Notes.** Pool status drives the freeze; see the freeze_toggled contract.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `pools_public_read` | anon, authenticated | SELECT | `true` | a pool's existence, name and status are public — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `pools_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `pool_fee_schedule`

**No DELETE.** a superseded schedule row is closed with effective_to, never deleted — entries snapshot the fee they were charged and the schedule is the evidence.

**Notes.** Operator has SELECT only: changing a price is a business decision that goes through a contract, so the change is audited. The CURRENT price is public on purpose: it is a published price, not a person's money, and the app renders it before any sign-in.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `fee_schedule_public_read` | anon, authenticated | SELECT | `effective_to IS NULL` | the current price must be visible; historical prices need not be |
| `fee_schedule_service_write` | service | SELECT, INSERT, UPDATE | `true` | price changes go through a contract so they are audited |

### `pool_entries`

**No DELETE.** withdrawal is a soft delete (deleted_at). A hard delete would remove an entry from a settled prize split with no trace.

**Notes.** anon may NOT insert. This is the biggest behaviour change in the model: today the browser writes entries directly. Server mediation is what makes the cutoff enforceable at all.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `entries_service_all` | service | SELECT, INSERT, UPDATE | `true` | entry creation and editing go through the create_entry contract, which enforces the cutoff server-side |
| `entries_self_select` | authenticated | SELECT | `participant_id IN (SELECT participant_id FROM participants WHERE auth_user_id = auth.uid())` | identity-aware; a participant may read their own entries |

### `payments`

**No DELETE.** a payment is reversed by a compensating row, never deleted. Deleting money movement destroys the audit trail that reconciliation depends on.

**Notes.** external_reference and memo are never exposed to any role but service; reports read a view that projects them away.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `payments_service_only` | service | SELECT, INSERT, UPDATE | `true` | every payment is recorded by the record_payment contract so it is audited and idempotent |

### `payment_allocations`

**No DELETE.** an allocation is corrected by a compensating allocation, never deleted.

**Notes.** The per-payment invariant SUM(allocations) <= payment.amount is enforced in the allocate_payment contract's transaction, because a CHECK constraint cannot see sibling rows.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `allocations_service_only` | service | SELECT, INSERT, UPDATE | `true` | allocation is the operation that decides which entry a payment settled; it must be transactional and audited |

### `prize_allocations`

**No DELETE.** a prize declaration is superseded, never deleted.

**Notes.** A public projection (name + rank + gross) is a VIEW, not a widened policy — the view can hide paid_amount, which is nobody else's business.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `prizes_service_only` | service | SELECT, INSERT, UPDATE | `true` | declaring a prize creates an obligation to pay someone |

### `ties`

**No DELETE.** competition facts are corrected, not deleted.

**Notes.** Public competition structure.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `ties_public_read` | anon, authenticated | SELECT | `true` | the bracket is public — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `ties_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `matches`

**No DELETE.** corrected, not deleted.

**Notes.** Written by the provider sync running as service.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `matches_public_read` | anon, authenticated | SELECT | `true` | fixtures are public — one policy TO anon, authenticated, since a signed-in user must not see less than an anonymous one |
| `matches_service_write` | service | SELECT, INSERT, UPDATE | `true` | reference and fixture data is written by the provider sync and by reference-data migrations, both running as service |

### `match_results`

**No DELETE.** a wrong result is SUPERSEDED by a new row, never deleted — the correction history is why a score changed.

**Notes.** Operator has SELECT only: recording or correcting a result changes every score in the pool, so it goes through the record_result contract.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `results_public_read` | anon, authenticated | SELECT | `is_official AND superseded_by_id IS NULL` | only the current official result is public; a superseded one would confuse a reader about which score counts |
| `results_service_write` | service | SELECT, INSERT, UPDATE | `true` | results are written by the provider sync and corrected through the record_result contract |

### `predictions`

**No DELETE.** a prediction is overwritten while open, frozen after cutoff; never deleted.

**Notes.** Other participants' predictions must NOT be readable before the cutoff — that would let someone copy a better player's picks. This is a fairness requirement, not a privacy one.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `predictions_service_write` | service | SELECT, INSERT, UPDATE | `true` | the submit_prediction contract is the only place the cutoff can be enforced with a trusted clock |
| `predictions_self_select` | authenticated | SELECT | `pool_entry_id IN (SELECT pool_entry_id FROM pool_entries e JOIN participants p USING (participant_id) WHERE p.auth_user_id = auth.uid())` | a participant may read their own predictions |

### `ranking_snapshots`

**No DELETE.** snapshots are immutable history. Even after an identity merge they are not re-pointed.

**Notes.** APPEND_ONLY: no UPDATE for any role, because editing a published standing rewrites what participants already acted on.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `rankings_public_read` | anon, authenticated | SELECT | `published_at IS NOT NULL` | a snapshot becomes public when it is published; an unpublished computation is a draft |
| `rankings_service_append` | service | SELECT, INSERT | `true` | snapshots are appended by the ranking job; no role may UPDATE one |

### `sync_state`

**No DELETE.** a cursor is reset by update, not deletion.

**Notes.** Exposed to operators through the operational_health report so a stale provider snapshot is visible — that failure mode otherwise produces no signal at all.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `sync_service_only` | service | SELECT, INSERT, UPDATE | `true` | cursors are runtime state of the sync job |

### `audit_events`

**No DELETE.** never. A deletable audit log provides no evidence, and a hash-chained row cannot be removed without breaking the chain.

**Notes.** NO UPDATE for any role, including service: immutability is the property that makes the chain worth computing.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `audit_append_only` | service | SELECT, INSERT | `true` | the audit log is written by every contract and read by investigations |

### `audit_event_details`

**No DELETE.** the row is redacted in place, not deleted, so the reference from the chained event stays intact.

**Notes.** The ONE table where UPDATE is intentional. That is the whole reason the sidecar exists: it lets erasure happen without breaking the audit chain.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `audit_details_service` | service | SELECT, INSERT, UPDATE | `true` | UPDATE is required here and only here, to null the snapshots for an erasure request |

### `outbox_events`

**No DELETE.** a delivered event is retained for its payload retention window, then its payload is dropped by a scheduled job — the row itself stays as delivery evidence.

**Notes.** Payload may contain a rendered email body, so it is service-only and expires at 90 days.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `outbox_service_only` | service | SELECT, INSERT, UPDATE | `true` | the worker leases, retries and completes events |

### `outbox_delivery_attempts`

**No DELETE.** never; the attempt history is the forensics.

**Notes.** NO UPDATE: an attempt happened or it did not.

| Policy | Role | Commands | Predicate | Why |
|---|---|---|---|---|
| `attempts_append_only` | service | SELECT, INSERT | `true` | attempts are append-only delivery evidence |

## Known gaps

### R-GAP-1 — there is no database-verifiable operator identity

- **Detail.** the admin password is a SHA-256 hash checked in the browser. PostgreSQL cannot verify it, so every 'operator' permission in this model is really 'service acting on an operator's behalf' until a real auth mechanism exists.
- **Consequence.** operator-only policies cannot be enforced by RLS alone today; they are enforced by the Edge Function that holds the service key.
- **Decision.** OPERATOR DECISION REQUIRED: adopt Supabase Auth for operators, or accept that operator authority lives in the server runtime and document it.

### R-GAP-2 — the prediction cutoff is enforced client-side only

- **Detail.** clock manipulation bypasses it, and the anon key allows a direct write today.
- **Consequence.** the fairness guarantee the whole scoring model rests on is currently unenforced.
- **Decision.** closed by the submit_prediction contract; requires the app to stop writing directly.

### R-GAP-3 — current production policies are identity-unaware row allowlists

- **Detail.** finding DR-1: none of the six policies references auth.uid() or any claim, so authorization effectively lives in browser JavaScript.
- **Consequence.** anyone with the public anon key can do whatever the policies permit, regardless of who they claim to be.
- **Decision.** superseded by this model; migration is phase M11.

## Write contracts

### S-1 — `create_entry`

**Why.** this is the contract that makes the cutoff real. A client-side cutoff is a suggestion.

| | |
|---|---|
| Auth | anon may CALL the endpoint; the endpoint runs as service. Rate-limited per IP and per email. |
| Validation | `pool exists and status = open`<br>`phase cutoff has NOT passed, measured against the SERVER clock`<br>`entry_label present and non-blank`<br>`participant resolved or created; NEVER merged`<br>`expected_fee snapshotted from the in-force fee schedule` |
| Transaction | one transaction: participant upsert + pool_entry insert + audit event + outbox event |
| Idempotency | client-supplied request id; a repeat returns the original entry rather than creating a second one |
| Audit event | entry_created (aggregate pool_entry) |
| Outbox | participant_receipt + admin_notification |
| Errors | `POOL_CLOSED`, `CUTOFF_PASSED`, `LABEL_REQUIRED`, `RATE_LIMITED`, `VALIDATION_FAILED` |
| Retry | safe to retry with the same request id; the idempotency key makes a duplicate submit a no-op |

### S-2 — `submit_prediction`

**Why.** predictions directly determine who is paid, so the lock must be enforced where the clock is trusted.

| | |
|---|---|
| Auth | anon may call with the entry's own token; runs as service |
| Validation | `entry exists and is not withdrawn`<br>`match/tie belongs to the entry's edition`<br>`cutoff not passed by the SERVER clock`<br>`exactly one subject (match XOR tie)`<br>`goals are integers >= 0` |
| Transaction | one transaction: prediction upsert + audit event |
| Idempotency | natural: (pool_entry_id, subject) is unique, so a resubmit overwrites while open |
| Audit event | prediction_submitted |
| Outbox | none — a receipt per pick would be noise |
| Errors | `CUTOFF_PASSED`, `UNKNOWN_SUBJECT`, `ENTRY_WITHDRAWN`, `INVALID_GOALS` |
| Retry | idempotent while open; after the cutoff it fails closed |

### S-3 — `record_payment`

**Why.** recording the same real payment twice would double the cash the pool believes it collected.

| | |
|---|---|
| Auth | operator only, via the server runtime |
| Validation | `amount is exact decimal and non-zero`<br>`sign agrees with kind (refunds negative)`<br>`currency is ISO-4217 and explicitly supplied — never defaulted`<br>`external_reference unique if present`<br>`payer participant resolved` |
| Transaction | one transaction: payment insert + audit event + outbox event |
| Idempotency | external_reference UNIQUE where not null; plus an operator-supplied request id |
| Audit event | payment_recorded |
| Outbox | admin_notification |
| Errors | `DUPLICATE_REFERENCE`, `SIGN_MISMATCH`, `CURRENCY_REQUIRED`, `AMOUNT_INVALID` |
| Retry | safe; the unique reference converts a duplicate into a no-op |

### S-4 — `allocate_payment`

**Why.** the per-payment invariant cannot be a CHECK constraint because it spans sibling rows, so the transaction is the only place it holds.

| | |
|---|---|
| Auth | operator only, via the server runtime |
| Validation | `payment and entry exist`<br>`same currency across payment, allocation and the entry's expected fee`<br>`SUM(allocations) <= payment.amount, checked inside the transaction`<br>`payment is not legacy_asserted (no amount to allocate)` |
| Transaction | one transaction: allocation insert + audit event; settlement is DERIVED afterwards, never written |
| Idempotency | operator-supplied request id; the transaction re-checks the invariant so a concurrent duplicate cannot both pass |
| Audit event | payment_allocated |
| Outbox | participant_receipt when the allocation settles the entry |
| Errors | `OVER_ALLOCATION`, `CURRENCY_MISMATCH`, `LEGACY_ASSERTED_HAS_NO_AMOUNT`, `UNKNOWN_ENTRY` |
| Retry | safe with the same request id |

### S-5 — `merge_identity`

**Why.** a merge moves money attribution between real people. It is the one contract where a silent retry is more dangerous than a visible failure.

| | |
|---|---|
| Auth | operator only; requires {operatorId, reason} |
| Validation | `both participants exist`<br>`neither is already superseded`<br>`not a self-merge`<br>`would not close a cycle`<br>`reason is non-empty` |
| Transaction | one transaction: link insert + canonical pointer + re-point entries/payments/prizes + audit event. Snapshots and audit rows are deliberately NOT re-pointed. |
| Idempotency | the link's (surviving, merged) pair is unique among unreversed links |
| Audit event | identity_merged, with the reason |
| Outbox | none — a merge is internal bookkeeping, not something to email anyone about |
| Errors | `ALREADY_MERGED`, `SELF_MERGE`, `WOULD_CREATE_CYCLE`, `REASON_REQUIRED`, `UNKNOWN_PARTICIPANT` |
| Retry | NOT blindly retryable: a second call with a new request id would be a second merge. The client must treat an ambiguous result as 'check state first'. |

### S-6 — `reverse_merge`

**Why.** reversibility is what makes the merge decision survivable; restoring from prior_state means it does not have to be reconstructed.

| | |
|---|---|
| Auth | operator only; requires {operatorId, reason} |
| Validation | `link exists and is not already reversed`<br>`reason non-empty` |
| Transaction | one transaction: restore prior_state + clear canonical pointer + restore prior alias set + mark link reversed + audit event |
| Idempotency | a second reversal of the same link fails with ALREADY_REVERSED |
| Audit event | identity_merge_reversed |
| Outbox | none |
| Errors | `ALREADY_REVERSED`, `UNKNOWN_LINK`, `REASON_REQUIRED` |
| Retry | safe: the second attempt fails cleanly rather than reversing twice |

### S-7 — `record_prize`

**Why.** declaring prizes creates an obligation to pay real money; declaring more than was collected is unrecoverable.

| | |
|---|---|
| Auth | operator only |
| Validation | `pool has a published final ranking`<br>`sum of declared prizes <= collected total`<br>`shares sum to exactly 1`<br>`currency explicit and consistent`<br>`each prize maps to an existing entry whose participant matches` |
| Transaction | one transaction: prize_allocations insert (all rows together) + audit event + outbox events |
| Idempotency | one unreversed prize allocation per (pool, rank_position) |
| Audit event | prize_declared |
| Outbox | participant_receipt per winner + admin_notification |
| Errors | `RANKING_NOT_PUBLISHED`, `PRIZES_EXCEED_COLLECTED`, `SHARES_DO_NOT_SUM`, `CURRENCY_MISMATCH`, `ALREADY_DECLARED` |
| Retry | safe with the same request id; partial declaration is impossible because all rows are inserted together |

### S-8 — `admin_correction`

**Why.** this is the highest-privilege operation available, so it is the one that most needs a field allowlist. An endpoint that can update anything is a second, unaudited schema.

| | |
|---|---|
| Auth | operator only; requires {operatorId, reason} AND names the specific field being corrected |
| Validation | `target row exists`<br>`field is on an ALLOWLIST of correctable fields — a general-purpose update endpoint is not a contract`<br>`before and after values captured into the redactable sidecar`<br>`reason non-empty` |
| Transaction | one transaction: targeted update + audit event + sidecar detail |
| Idempotency | operator-supplied request id |
| Audit event | admin_correction, with before/after in the sidecar and only references in safe_metadata |
| Outbox | admin_notification |
| Errors | `FIELD_NOT_CORRECTABLE`, `REASON_REQUIRED`, `UNKNOWN_TARGET`, `WOULD_VIOLATE_INVARIANT` |
| Retry | safe with the same request id |
