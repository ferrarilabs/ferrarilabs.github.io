# ADR-K06 — bulk audit chain construction for the M10 backfill

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F014 · Found and resolved on the way: KPLUS-F025, KPLUS-F026
Governs: `audit.event_canonical_v1`, `audit.event_hash_v1`, `scripts/db/audit_chain_backfill.mjs`

## Decision

The M10 audit backfill loads history into a migration-time staging table carrying an explicit
`ordinal`, computes the whole hash chain there in **one recursive pass**, inserts the finished rows
into `audit.audit_events` with the chain trigger suspended, and only then seeds the chain head from
what the target actually contains.

The chain hash has exactly **one implementation**, `audit.event_canonical_v1` + `audit.event_hash_v1`,
created in M1. The append trigger, the bulk builder and every verifier call it. The canonical
serialisation is no longer written out anywhere else.

## Why this was not an operator question

`model/migration_choreography.json` already declares M10's race strategy as
`APPEND_ONLY_CHAIN_RECOMPUTE` — *"the chain is computed in document order"* — and `PHASE_META.M8`
already says *"hash chain computed in document order"*. KPLUS-F014 already recorded the measurement and
already named the remedy: *"load the rows with the chain trigger suspended, then compute the chain in one
pass and seed the head."* Business meaning, financial meaning, scoring meaning and PII exposure are all
unchanged; production is untouched; every part is reversible. That is YELLOW.

## The decisions inside this one

**1. Where does the canonical serialisation live?** *Chosen:* one SQL function in the database, called
by everything. *Alternative:* let the backfill restate the expression, as the trigger and the F013 lab
already did — three copies would have become four. *Why:* a restatement that drifts by one separator
produces hashes that look fine, verify fine against themselves, and are incompatible with every event
appended after the migration. Nobody would notice until the first live append failed to chain, by which
time the history is written. This is the failure mode `CLAUDE.md` records for `send_result_email.py`,
in the audit spine. Proven byte-identical to the pre-extraction text in F014-2 and F014-3, against a
frozen copy of the original expression, with the comparator shown to fail on a one-character change.

**2. Scalar parameters or a row type?** *Chosen:* thirteen scalars, and every call site must use named
arguments (a gate asserts it). *Alternative:* `audit.event_canonical_v1(e audit.audit_events)`, which
reads better. *Why:* the functions are created in M1 and the table does not exist until M8, so a
row-typed parameter cannot be declared there. Named arguments recover the safety a row type would have
given: transposing two same-typed columns is exactly the mistake that yields a plausible, self-consistent,
wrong chain, and it cannot be made silently.

**3. Compute the chain in staging, or fix it up in place?** *Chosen:* staging. The procedure never issues
an `UPDATE` or `DELETE` against `audit.audit_events`, and a test enforces that. *Alternative:* insert
rows first and chain them afterwards. *Why:* `audit_events` is append-only, so in-place chaining needs
the refusal triggers suspended around a statement that rewrites audit history. Such a tool, once it
exists, can be pointed at events that were never part of any backfill. The append-only property should
not have an official exception.

**4. What decides the order?** *Chosen:* an explicit `ordinal`, unique and contiguous from 1. *Why:*
two legacy events can share a timestamp and `audit_event_id` is random, so neither can order a chain.
A gap in the ordinals means an event went missing between extraction and staging, and the chain would
then attest to the survivors — so a gap is a refusal, not a warning.

**5. Seal from staging or from the target?** *Chosen:* from `audit.audit_events`. *Why:* sealing from
staging records the head the plan intended. If promotion lost a row, that head names a hash no event
carries and the next append chains onto nothing. Reading it back from the target is the difference
between "the head agrees with the table" and "the head agrees with the plan".

**6. Is the trigger suspension what makes the hashes right?** *No — and the lab corrected me on this.*
F014-7b was written expecting promotion-without-suspension to corrupt the chain. It does not: the
trigger recomputes the **identical** 52 hashes, because both paths run the same function over the same
rows in the same order. That result is now the strongest equivalence proof in the workstream. The
suspension is required for two other reasons, both measured: the trigger path is order-dependent
(F014-7c: reversing the feed matched on 0 of 52 rows, and PostgreSQL does not promise the order in which
a BEFORE trigger sees an `INSERT ... SELECT ... ORDER BY`), and it does not finish (F014-9c).

## Two findings discovered while building this

**KPLUS-F025 [HIGH] — every real audit event was refused by its own CHECK.** `transformAuditMetadata`
passed the legacy verb through verbatim (`save-leg`, `lock-tie`), and `audit_events` carries
`CHECK (action ~ '^[a-z_]+\.[a-z_]+$')`. All 52 real events from the three pools were rejected: the M8/M10
audit domain was entirely unloadable, proven against the real column. Fixed by namespacing rather than
reinterpreting — `legacy.save_leg`. Mapping `edit` onto `pool_entry.updated` would assert a subject and a
verb the legacy log never recorded; the namespace is lossless and honest about provenance. A verb that
cannot be expressed in `[a-z_]` (a digit) is FATAL, so the domain reads nothing rather than loading an
altered history. `aggregate_type` also stopped claiming `pool_entry` for the 33 events that name no
entry. Same class as F015/F016/F017: invisible until real data met the real column.

**KPLUS-F026 [MEDIUM] — the seal was quadratic on stale statistics.** Found by the seal not finishing in
twelve minutes. Promotion fills the table in one statement; until it is analysed the planner still thinks
it holds 52 rows and costs the tail lookup's anti-join as a nested loop over 200,000. Measured:
row estimate 52 → 200,000, plan `Nested Loop` → `Hash Anti Join`, seal 12 min+ → 0.3s. Fixed with a
mandatory `ANALYZE` step between promotion and the seal. It is KPLUS-F014's own trap one level up: there
the bulk WRITE was quadratic, here the two statements that READ it were.

## What changed

- `scripts/db/generate_migration_drafts.mjs` — `AUDIT_CHAIN_DDL`: two new functions, the trigger now
  calls them, `REVOKE ALL ... FROM PUBLIC` on both (the first callable functions in the `audit` schema,
  which is the inheritance KPLUS-F023 predicted).
- `docs/bolao/db-modernization/migration-drafts/M1_schema_extensions_and_enum_types.draft.sql` — regenerated.
- `scripts/db/audit_chain_backfill.mjs` — new: the staging DDL, preconditions, chain pass, promotion,
  analyze, seal, verifier, and the plan tying them together.
- `scripts/db/transformers.mjs` — `transformAuditMetadata` (KPLUS-F025).
- `scripts/db/backfill_domains.mjs` — `auditDomain.validateRow` also checks the action shape.
- `scripts/db/test_audit_chain_backfill.mjs`, `scripts/db/test_transformers.mjs` — tests.

## Tests that prove it

`f014_audit_chain_backfill_lab.mjs`, 26/26 against real PostgreSQL 17.10, plus 31 unit assertions in
`test_audit_chain_backfill.mjs` and 4 in `test_transformers.mjs` (all four shown to fail pre-fix).

Load-bearing, in order: the extracted function is byte-identical to the frozen original over probes
covering all-NULL, all-populated, unicode and jsonb-key-order inputs, **and the comparator is shown to
fail** on a chr(31)→chr(29) change (F014-2); the trigger still produces the original value (F014-3); all
52 real events load and the chain verifies (F014-4); **a live append continues the bulk chain** (F014-5);
the trigger recomputes the bulk chain exactly (F014-7b) but is order-dependent where the bulk pass is not
(F014-7c); a re-run, a withheld row and a tampered row are each refused or detected (F014-6, F014-8); the
bulk path does 200,000 events in ~7s where the trigger path is killed at 60s (F014-9); and the lab
restores the catalog digest byte for byte and leaves the money spine at 24/46/46/0 (F014-10).

Regression: gates 45/45 across 33 suites, three `audit_scoring.py` pass, `a15` 0 unexplained structural
differences, `c_catalog_fidelity` 523 comparisons / 0 defects / 12 advisory.

## How to reverse it

Replay the previous `AUDIT_CHAIN_DDL` (the trigger with the serialisation inline) and
`DROP FUNCTION audit.event_hash_v1(text), audit.event_canonical_v1(...)`. Hashes are unchanged either
way — that is what F014-2 proves — so no chain has to be rebuilt. `scripts/db/audit_chain_backfill.mjs`
is inert until something calls it; deleting it removes the procedure and nothing else. The F025
transformer change is reversible in isolation, but reverting it restores a state in which no real audit
event can be loaded at all.
