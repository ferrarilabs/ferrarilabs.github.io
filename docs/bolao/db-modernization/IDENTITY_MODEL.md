# IDENTITY_MODEL — participant identity, aliases, merge and reversal

**Workstream C.** Implementation-grade. Executable counterpart: `scripts/db/identity.mjs`,
tests `scripts/db/test_identity.mjs` (35 assertions).

Status: **DESIGN COMPLETE, NOT APPLIED.** No production DDL, DML or policy change.

---

## 1. The governing rule

> **No identity is ever merged automatically on the basis of a name or an email.**

Not "obvious" matches. Not exact-email matches. Not case-normalised name matches. The engine
**suggests**; only an operator decision, carried as an explicit `{operatorId, reason}` confirmation,
can merge.

### Why, given that an exact email match looks safe

Every one of these looks like an exact duplicate and is not:

| Situation | What the data looks like |
|---|---|
| A family sharing one mailbox | two entries, same email, different names |
| One person entering under a partner's address | two entries, same email, same surname |
| Three colleagues using a shared work address | three entries, same email |
| Two real people with a common name | two entries, same name, no email |

The two error directions are **not symmetric**:

- **Wrong merge** → two people's payments and prize entitlements collapse into one identity. Real
  money. Reversal is a manual reconstruction, and the wrong person may already have been paid.
- **Missed merge** → a fragmented history. Nothing else.

So the engine is deliberately biased toward not merging.

### How the bias is enforced structurally, not by prose

- `mergeIdentities()` **throws** without `{operatorId, reason}`. Not a defaulted parameter — a default
  would make the unconfirmed path the easy one.
- `findDuplicateCandidates()` and `mergeIdentities()` **do not call each other**. There is no code
  path from a suggestion to a merge.
- There is **no** `autoMerge()` / `mergeIfConfident()` function. A test asserts by source scan that
  none has appeared, and that `mergeIdentities` does not read `confidence` at all — that function is
  exactly how this control gets bypassed under deadline pressure.
- Confidence is an **ordinal label** (`STRONG`/`MODERATE`/`WEAK`), never a number. A score invites a
  threshold; a threshold invites automation. You cannot write `if (score > 0.9) merge()` against a
  label without naming the label, which is visible in a diff.
- Every candidate carries `autoMergeable: false` and `requiresOperatorConfirmation: true`, so no
  caller can claim it did not know.

---

## 2. Entities

### `participants`

| Column | Notes |
|---|---|
| `participant_id` | PK, immutable surrogate |
| `display_name` | current name; `CONTACT` PII |
| `email` | nullable, `CONTACT` PII; stored as given, compared normalised |
| `aliases` | every other name this person has been known by (see §3) |
| `canonical_participant_id` | NULL for an active identity; set → this row is **superseded** |
| `superseded_at` | when the merge happened |

A superseded row is **never deleted**. Deletion would destroy the very history the merge consolidates
and would make reversal impossible.

### `participant_identity_links`

One row per merge **event**, retained forever — including after reversal.

| Column | Notes |
|---|---|
| `link_id` | PK |
| `surviving_participant_id` | the canonical identity |
| `merged_participant_id` | the superseded identity |
| `confirmed_by` | operator id — the whole access-control story at the data layer |
| `reason` | mandatory free text; an unexplained merge cannot be reviewed |
| `prior_state` | `{display_name, email, aliases}` of the merged row **before** the merge |
| `prior_surviving_aliases` | the survivor's alias set before the merge |
| `merged_at` | |
| `reversed_at` / `reversed_by` / `reversal_reason` | NULL while active |

`prior_state` exists because **provenance that cannot reconstruct the prior state is not
provenance** — reversal must restore exactly what existed, not guess at it.

---

## 3. Aliases

On merge, the survivor inherits the merged identity's `display_name` and aliases. Without this, the
next duplicate scan re-suggests the pair the operator just resolved, and an operator who is shown the
same resolved pair repeatedly learns to click through the queue.

Aliases participate in candidate detection: a match against a stored alias is a match.

On reversal, the survivor's alias set is **restored from `prior_surviving_aliases`**, not computed by
subtraction. Subtraction would drop an alias the survivor legitimately gained from a *different*
merge in between.

---

## 4. Candidate detection signals

| Signal | Meaning |
|---|---|
| `EXACT_EMAIL` | normalised emails equal |
| `NORMALISED_NAME` | names equal after case/whitespace normalisation |
| `FOLDED_NAME` | names equal after accent folding (`José` ≡ `Jose`) |
| `NAME_TOKEN_PERMUTATION` | same tokens, different order (forename/surname swapped) |
| `SHARED_PAYER` | context only — reported, never sufficient alone |

Confidence:

| Label | Condition |
|---|---|
| `STRONG` | `EXACT_EMAIL` **and** a name signal |
| `MODERATE` | `EXACT_EMAIL` **or** `NORMALISED_NAME` alone |
| `WEAK` | anything else |

A shared mailbox with two different names lands at `MODERATE` **by design** and can never reach
`STRONG` — that is the shared-mailbox false positive, and it must look different from a real duplicate.

### Deliberately excluded signals

| Rejected signal | The false positive that rejects it |
|---|---|
| same display name alone | common names; two different real people |
| same payment method | everyone uses the same two apps |
| adjacent `createdAt` | a family registering together in one sitting |
| same payer (alone) | a parent paying for three children |

`SHARED_PAYER` is emitted only to enrich a pair that some other signal already raised.

---

## 5. Refusal taxonomy

| Code | Refused because |
|---|---|
| `NO_CONFIRMATION` | no operator id + reason (also required for reversal) |
| `SELF_MERGE` | merging a participant into itself creates a 1-cycle |
| `MISSING_PARTICIPANT` | unknown participant or link |
| `ALREADY_MERGED` | re-merging would overwrite existing provenance — reverse first |
| `SURVIVOR_IS_SUPERSEDED` | merging into a superseded row buries data one hop deeper |
| `WOULD_CREATE_CYCLE` | the survivor already resolves through the merged identity |

`resolveCanonical()` **throws** on a corrupt cycle rather than looping — a hang here would stall
every report that resolves an identity.

Database-level backstops (Workstream K/R): `CHECK (canonical_participant_id <> participant_id)`,
`CHECK (surviving_participant_id <> merged_participant_id)`, and rule **DQ-ID-03** for cycle
detection across the whole set.

---

## 6. Row re-pointing after a merge

| Table | Column | Action | Why |
|---|---|---|---|
| `pool_entries` | `participant_id` | **REPOINT** | entries follow the person |
| `payments` | `payer_participant_id` | **REPOINT** | payments follow the payer |
| `prize_allocations` | `participant_id` | **REPOINT** | winnings follow the person |
| `ranking_snapshots` | `participant_id` | **LEAVE** | a snapshot records a standing **as published**; re-pointing retroactively rewrites history |
| `audit_events` | `actor_participant_id` | **LEAVE** | audit rows are immutable; who acted then does not change |

Re-pointing is a separate function (`repointAfterMerge`) from the merge itself, so the two can be
reviewed independently — the merge decision and the data movement have different risk profiles.

---

## 7. Payer identity vs entry owner

They are **independent** and stay independent through a merge. A third-party payer funding someone
else's entry keeps their own identity when the *entrant* is merged, and vice versa.

Where the payer is known only by a free-text name (all legacy rows — there is no payer email in
`bolao_state`):

- payer name **identical** to the entrant's name ⇒ self-payment, same participant. Not a guess: one
  entry, one name.
- payer name **different** ⇒ a separate identity, and it stays **UNKNOWN-1**. A third party paid and
  only an operator can say who they are. Guessing here misattributes someone's money.

This exact defect was found by the parity harness (PAR-14/PAR-15) rather than by review.

---

## 8. Identity audit history

`identityHistory(state, participantId)` returns every merge the participant took part in, in
chronological order, with `role` (`SURVIVOR`/`MERGED`), `counterparty`, `confirmed_by`, and
`status` (`ACTIVE`/`REVERSED`). Reversed merges remain visible: **that a merge happened and was
undone is itself history.**

---

## 9. Test coverage (`test_identity.mjs`, 35 assertions)

| Scenario | Assertion |
|---|---|
| legitimate duplicate candidate | found, `STRONG`, both signals |
| false-positive duplicate (shared mailbox) | found but capped at `MODERATE` |
| accent-folded name | found, `WEAK` |
| unrelated participants | **not** suggested (noise causes blind approval) |
| name-token permutation | found |
| multiple historical aliases | alias matches are found |
| already-merged identity | excluded from detection; re-merge refused |
| merge | supersedes without deleting; full provenance; pure function |
| merge cycle rejection | self-merge, cycle-closing merge, superseded survivor all refused |
| reverse merge | exact prior state restored; link retained and marked; pair returns to queue; re-merge possible |
| payer ≠ participant | payer untouched when entrant is merged |
| no-auto-merge | source scan for auto-merge paths; `STRONG` still refuses |

---

## 10. Open operator decisions

| Id | Decision needed |
|---|---|
| **UNKNOWN-1** | For each legacy third-party payer known only by free-text name: who is that person? Cannot be resolved from data. |
| **C-OP-1** | Who holds operator authority to confirm merges, and is a second approver required for a merge that moves prize entitlements? |
| **C-OP-2** | Retention for reversed link rows — this design says indefinite; confirm against the 5-year financial retention posture. |
