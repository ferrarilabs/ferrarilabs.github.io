# ADR-K01 — server-generated audit hash chain, and append-only enforcement

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F013(b), KPLUS-F013(c) · Governs: `audit.audit_events`

## Decision

The audit hash chain is computed by a `BEFORE INSERT` trigger on the server; `audit_events` is
append-only, enforced by `BEFORE UPDATE` / `BEFORE DELETE` triggers that raise, at row AND statement
level, in addition to the existing privilege position.

## Why this was not an operator question

`TARGET_DATA_MODEL.md` already specifies it: *"Enforcement: `BEFORE UPDATE`/`BEFORE DELETE` triggers
that raise; `BEFORE INSERT` trigger computing the chain."* The model's `event_hash` column says
*"Computed by a BEFORE INSERT trigger over the NON-PII columns only"*, and `audit_events.purpose`
opens with *"Append-only, hash-chained record"*. The business meaning is fixed; only the mechanism was
open, which is the definition of YELLOW. Nothing here changes what is audited, what it means, who may
read it, or any financial or scoring semantic.

## What the chain covers

The non-PII columns of `audit_events` only, in a fixed order, version-tagged `v1`. The
`audit_event_details` sidecar is a different table and is excluded. That exclusion is the entire
mechanism behind **G-02**: PII can be redacted from the sidecar without invalidating a single link.
An audit log you cannot redact and a privacy right you cannot honour are the same problem.

## The three decisions inside this one

**1. How the predecessor is found.** *Chosen:* the OPEN END of the chain — the one event whose
`event_hash` nothing references as its `previous_event_hash`.
*Rejected:* ordering by `occurred_at, audit_event_id`. Two events can share a timestamp, and
`audit_event_id` is a random uuid, so that sort can disagree with insertion order and link a new event
to the wrong predecessor. The open-end query depends on no clock and no identifier ordering, and is
exact.

**2. How a fork is prevented.** *Chosen:* both a transaction-scoped advisory lock (`pg_advisory_xact_lock`)
serialising every audit insert, AND a partial UNIQUE index on `previous_event_hash`.
*Rejected:* either one alone. The lock alone leaves the chain's most important property depending on a
line of procedural code that a future edit could remove; the index alone would make one of two
concurrent writers fail with a duplicate-key error rather than simply ordering them. Together, writers
are ordered in the normal case and a fork is *structurally impossible* even if the lock is removed.
Proven by bypassing the trigger entirely (`session_replication_role = replica`) and watching the index
refuse the second claimant — check F013b-6.

**3. Canonical serialisation.** `concat_ws(chr(31), …)` with `chr(30)` as the explicit NULL marker,
both written as SQL function calls rather than string escapes. `safe_metadata` is serialised through
`jsonb`, which normalises key order and whitespace so a semantically identical payload always hashes
the same. `occurred_at` is rendered in UTC with microsecond precision. The hash uses `sha256()` and
`convert_to()` — both in `pg_catalog` — rather than pgcrypto's `digest()`, because the function pins
`search_path` for security and pgcrypto lives in a schema that pin deliberately excludes.
Column set, order and the `v1` tag are fixed deliberately: changing any of them changes every future
hash, and that must be a reviewed migration rather than a side effect of someone adding a column.

## Cost accepted

One global advisory lock on audit writes serialises them. At this application's scale — hundreds of
events per round — that is not a constraint, and the campaign brief is explicit that integrity
outranks performance here. If audit write volume ever became a bottleneck, the lock could be narrowed
or the chain sharded per aggregate; the UNIQUE index would continue to hold the no-fork property
during any such change.

## The escape path, stated because an undocumented one is worse

`SET session_replication_role = replica` suspends the triggers. It requires superuser, which no
application principal holds (`anon`, `authenticated`, `service_role` — none has superuser or
BYPASSRLS; verified in check F013c-2). It exists so a migration can rebuild the table, and it is the
mechanism the lab itself uses to prove tampering is *detected* rather than merely absent.

## Evidence that it works, and that the checks can fail

`f013_integrity_lab.mjs`, 16/16 against real PostgreSQL 17.10:
client-supplied `event_hash` discarded · client-supplied `previous_event_hash` discarded · one
genesis, one open end, no orphan link · every stored hash still matches its row · **a tampered row is
detected** (triggers suspended, one row edited, exactly one hash stops matching) · **a fork is refused
with the trigger bypassed** · two concurrent writers extend one chain with neither failing · nine
adversarial mutations all refused, including bulk DELETE, a DELETE matching zero rows, and TRUNCATE ·
the escape path closed to application principals.

## How to reverse

Drop the five triggers and the two functions; drop the two indexes added to `audit_events` in
`model/target_model.json`. No data migration is required — `event_hash` and `previous_event_hash`
already existed as columns. Reversal restores the prior (defective) behaviour and would be caught
immediately by this lab.
