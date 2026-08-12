# ADR-K10 — Two migration channels write the same production database, and only one of them knows it

**Status:** ACCEPTED as a description of reality. The remediation it implies is NOT authorized and is not done.
**Date:** 2026-08-11
**Finding:** KPLUS-F057 (and it is why KPLUS-F055 happened)
**Supersedes:** nothing. **Amends:** the implicit assumption behind every artefact in this programme.

---

## Context

The authorized read-only window of 2026-08-11 measured **ten tables** in production's `public` schema.
Every artefact in this programme was built on **seven**: the fence model, the target model, the restored
baseline, the migration reconciliation, and `supabase/migrations/BASELINE_current_production_state.reference.sql`.

The three unmodelled tables are not anomalies and not accidents. Each has clean provenance on branch
`main`:

| table | origin | purpose |
|---|---|---|
| `bolao_entry_private` | `main` 727e785, `bolao/shared/sql/015_f10_private_pii_and_public_projection.sql` | F10 stage 1 — move participant PII out of `bolao_state`, where the public anon key could enumerate it |
| `bolao_notif_jobs` | `main` 876918d, `bolao/shared/sql/010_notification_durability.sql` | durable notification outbox with leases, idempotency, retry |
| `live_sports_cache` | `main` 41496b4, applied via `supabase db query` — **DDL never committed anywhere** | shared ESPN cache for public sports data |

So there are **two migration channels operating on one production database**:

- **A.** `supabase/migrations/` on `db-modernization-architecture` — what this programme models.
- **B.** `bolao/shared/sql/NNN_*.sql` on `main` — a hand-numbered series, 010 through 026, applied by the
  product team. This branch has never contained a single one of them.

## The part that decides the decision

**The information flow was one-way, and channel B was the one being careful.**

Commit 41496b4 on `main` records that the live cache table was created with `supabase db query` rather
than `db push` *specifically* to avoid disturbing this programme's migration ledger — it names the remote
migration `20260806143644` and states that "as sete tabelas existentes ficaram intactas (verificado antes
e depois)". The product team knew this programme existed, understood the hazard, and worked around it
deliberately.

Nothing told this programme about them. Every check we built asked "does production match our model?" and
answered it against a **restored baseline** — a copy of production taken on 2026-08-07, before F10 and
live-v2 landed. A copy cannot report drift in its original.

That is the root cause, and it is the same one as KPLUS-F039 (roles), KPLUS-F012 (event triggers) and
KPLUS-F055 (tables): **the restore was treated as evidence about production.** Three findings, one
mistake, in three different object classes.

## Decision

**1. The baseline reference records the drift, with provenance, and does not pretend to be a fresh capture.**
The 2026-08-07 body stays as it is — it was faithful when written, and rewriting it would destroy the
evidence that production drifted. The drift is appended and dated.

**2. Each table is classified on evidence, and classification is not migration.**

| table | classification | why this and not another |
|---|---|---|
| `bolao_entry_private` | **TARGET_ENTITY** | it holds exactly the attributes M2/M4 model — participant e-mail, payer name, payment method. It is target data living in a legacy shape. |
| `bolao_notif_jobs` | **DEFERRED_WITH_REASON** | it is a *working production outbox* and M9 designs *another one*. Two live designs for one concern is an architectural decision, not a classification. |
| `live_sports_cache` | **LEGACY_ONLY** | public sports data, deliberately separated from `bolao_state`, degrades to source on failure. Nothing in the money or scoring spine touches it. |

**3. `bolao_entry_private` is NOT added to the normalized target by this ADR.** Its classification says it
*belongs* there; adding it is a modelling change that must reconcile against M2/M4 and against whatever
`bolao_state.state->'entries'` still holds. Classifying and migrating are separate steps, and collapsing
them is how a target model acquires an entity nobody reconciled.

**4. The programme stops assuming it is the only writer.** Concretely: `productionDrift()` exists,
`MEASURED_PRODUCTION_PRIVILEGES` is dated, and the model-vs-measurement agreement is asserted in both
directions by a test. A future divergence is a failing check, not a discovery at cutover.

## The consequence that is not about tables at all

**F10 is staged, and its Stage 6 has not run.** Its own file says the revocation is deferred so clients can
migrate first, and the 2026-08-11 read confirms anon still holds `SELECT` on `bolao_state`.

This programme's transformers read participant e-mail and payer name out of `bolao_state.state->'entries'`.
They work **today** because the PII is still in both places. When F10's later stages remove it from
`bolao_state`, the transformers silently start producing entries with no participant identity — and the
backfill would complete, because a missing optional field is not an error.

That is a **live coupling between two programmes that do not read each other's branches**, and it is worth
more attention than the three tables that revealed it.

## Consequences

- **Accepted:** the baseline reference is now a dated capture plus a dated drift record, not a single
  snapshot. It is honest and it is uglier.
- **Accepted:** two channels keep operating until someone decides otherwise. This ADR describes; it does
  not authorize a merge, a migration, or a revocation.
- **Cost:** any future production read must re-check the table set, because the model can only ever be as
  fresh as the last read.
- **Not addressed here:** whether channel B should be folded into channel A. That is a decision for the
  operator and the product team together, and neither this ADR nor this campaign may take it.

## Regression controls

- `test_legacy_fence.mjs` — the model and `MEASURED_PRODUCTION_PRIVILEGES` must agree in **both**
  directions; the pre-fix seven-table list is pinned and shown to fail.
- `productionDrift()` — mutation-tested for a widened grant, an eleventh table, a vanished table, and an
  empty read.
- `test_backup_scope.mjs` — production's enumerated event triggers reproduce the classifier's split with
  no adjustment.

## Still open

- **KPLUS-F058** — PROBE-4 filtered `relkind = 'r'`, so **views were never enumerated**. Commit 727e785
  creates `bolao_state_public`. The legacy surface is complete for tables and unknown for views.
- **`live_sports_cache` has no DDL in version control anywhere.** Reconstructing it requires either a
  production read or the product team.
- **`anon` holds full CRUD on `bolao_notif_jobs`.** RLS state was not read. Exposure to assess, not a
  confirmed incident.

---

# PART II — the decisions (completed 2026-08-11, Governor Mode)

Part I described the situation and stopped at "classified but architecturally undecided". That is not an
acceptable resting place, so each question below is now answered. Decisions that are **safe and
reversible** are taken here. Decisions that would move money semantics, scoring semantics, or another
product's behaviour stay **RED** and are presented, not taken — those are marked as such and nothing in
this repository acts on them.

## D-1. Do the three tables belong in the target architecture?

| table | decision | reversible? |
|---|---|---|
| `bolao_entry_private` | **YES — TARGET_ENTITY, but NOT migrated by this programme.** | n/a — no change made |
| `bolao_notif_jobs` | **NO — stays product-owned.** | n/a |
| `live_sports_cache` | **NO — LEGACY_ONLY, permanently outside the target.** | n/a |

**`bolao_entry_private` — TAKEN, and deliberately narrow.** Its columns (`participant_email`, `payer_name`,
`payment_method`, `payment_to`, keyed by `pool_id`/`entry_ref`) are precisely the attributes M2
`participant_identity` and M4 `pool_entries` model. It is target data in a legacy shape, so classifying it
as anything else would be false.

What is **not** decided: importing it. The target already models these attributes and is backfilled from
`bolao_state.state->'entries'`, so a naive import creates two sources for one fact. Reconciling them is a
data-migration design with money-adjacent identity semantics — `payer_name` and `payment_method` feed
payment attribution — and that is **RED**. Recorded as such rather than attempted.

**`bolao_notif_jobs` — TAKEN.** It is a working production outbox with leases, idempotency and retry, and
M9 `outbox_events` designs another. Two live outboxes is not a modelling question, it is an ownership
question, and the answer that requires no change is the safe one: the product keeps its outbox, the target
keeps M9 for its own events, and neither migrates into the other. Should they ever converge, that is a
separate decision with its own ADR.

**`live_sports_cache` — TAKEN.** Public sports data, no participant reference, no money, degrades to source
on failure. It has no place in a normalized bolão model and never will.

## D-2. How are their privileges governed?

**TAKEN.** By `scripts/db/privilege_model.mjs`, exactly like every other relation — that is the entire
point of building it. Specifically:

- `bolao_entry_private` — already at target for `anon` (holds nothing; F10 revoked it deliberately).
  `authenticated`'s CRUD is an **EXPECTED_REVOKE**: nothing browser-side should reach PII directly.
- `bolao_notif_jobs` — `anon`'s full CRUD is a **PLATFORM_DEFAULT** diff, not a grant anyone wrote.
  Revoking it is generated and rehearsed; **applying it is the product's call** because the queue may be
  fed through that path. RED, presented.
- `live_sports_cache` — `anon` keeps `SELECT` as a **permanent** LEGACY_COMPATIBILITY_EXCEPTION; the
  payload is public and the browser reads it directly by design. `authenticated`'s CRUD is an
  EXPECTED_REVOKE.

## D-3. Do they participate in backup/restore?

**TAKEN — YES, all three, and they always did.** They live in `public`, so `pg_dump --schema=public`
carries them; nothing needed to change. What *did* need to change, and has, is that the backup scope now
also carries the event triggers (KPLUS-F012) and the restore verifies them.

One consequence worth stating: `live_sports_cache` is a **cache**, and restoring a stale cache is worse
than restoring an empty one. It is not excluded from the dump — excluding relations by hand is how scope
drifts — but a restore runbook step should truncate it rather than trust it. Recorded as a runbook item.

## D-4. Are they in cutover / fence scope?

**TAKEN — no, and this is now enforced rather than assumed.** Only `bolao_state` and its two views are
fenced, because only they are the migration subject or a writable projection of it. The three tables are
modelled in `LEGACY_RELATIONS` so an unmodelled relation is a loud failure, and `productionDrift()` makes
a future addition a failing check rather than a discovery at step 11.

## D-5. Retirement / retention

| table | criterion |
|---|---|
| `bolao_entry_private` | **RETAIN INDEFINITELY.** It is the F10 remediation. It gets retired only if its data is migrated into the target *and* every reader moves — which is the RED decision in D-1, not a retirement schedule. |
| `bolao_notif_jobs` | **RETAIN — product-owned.** Retirement belongs to whoever owns the notification path. |
| `live_sports_cache` | **RETAIN.** Retiring it means going back to per-visitor ESPN fetches, which is the regression it was built to fix. |

Note what is absent: none of these has a retirement criterion of the form "once the normalized tables
exist". That reasoning is what KPLUS-F058 nearly applied to `bolao_state_public`, and it is wrong in the
same way each time — a replacement existing says nothing about whether anyone moved to it.

## D-6. What stays RED

1. **Importing `bolao_entry_private` into the target.** Money-adjacent identity semantics.
2. **Revoking `anon`'s CRUD on `bolao_notif_jobs`.** May be how the queue is fed; another product's behaviour.
3. **Reconciling the two migration channels.** Requires both teams.
4. **F10's remaining stages vs. this migration's transformers.** The coupling in Part I; sequencing is a
   joint decision and the failure mode is silent.

## Status

**ADR-K10: ACCEPTED and COMPLETE.** D-1 through D-5 are decided. D-6 lists four decisions that are
explicitly *not* this campaign's to take, each with the reason. No production object was changed by this
ADR.
