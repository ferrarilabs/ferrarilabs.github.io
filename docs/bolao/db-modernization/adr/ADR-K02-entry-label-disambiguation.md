# ADR-K02 — disambiguating entry labels so a second entry survives the migration

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F016 · Governs: `transformPoolEntries` in `scripts/db/transformers.mjs`

## Decision

When two entries by the same participant in the same pool carry the same `entry_label`, the
transformer keeps the first (in sorted `pool_entry_id` order) and gives each subsequent one
`<label>-2`, `-3`, … skipping any suffix another entry already claims explicitly. Nothing is dropped
and nothing is merged. The change is always reported: `ENTRY_LABEL_DISAMBIGUATED` (WARNING) when both
labels were defaulted, `ENTRY_LABEL_COLLISION` (CONFLICT) when both were supplied explicitly.

## The problem, as measured

Discovered by loading the real legacy documents into the real target — not by reading code. The
`pool_entries` backfill halted on batch 4 with a `unique_violation`.

- Real legacy data carries **no** `entryLabel` on any entry: all 46 defaulted to the literal `"main"`.
- `pool_entries_participant_id_pool_id_entry_label_uidx` is UNIQUE on
  `(participant_id, pool_id, entry_label)`.
- **5 of 46 real entries** (all in the `main`/copa2026 pool, 3 colliding groups) therefore could not be
  inserted at all.

Multiple entries per participant per pool is a **RATIFIED** requirement — the model's own note on
`pool_entries.participant_id` says the uniqueness on `(participant_id, pool_id)` was deliberately
removed for it, and the note on `entry_label` says the label is *"the only thing distinguishing an
intentional second entry from an accidental duplicate"*. So the colliding rows are real entries owing
real fees, and the defaulting rule was quietly destroying the very case the schema was changed to
support.

## Why this was not an operator question, and not merely GREEN

Not RED: no money changes. Every one of the 46 entries owes the same ratified 5.00 USD before and
after; the fix *preserves* 5 entries × 5.00 USD of expected fees that the alternative would lose. No
scoring rule, no payment attribution, no prize semantic and no PII exposure is touched. Production is
untouched and the choice is reversible by a future migration (`UPDATE ... SET entry_label` over rows
matching the suffix pattern, or by supplying real labels).

Not GREEN: several defensible label schemes exist and the choice is visible to participants, so it
gets a recorded rationale rather than a silent one.

## Alternatives considered

**Drop the colliding entries.** Rejected outright. It loses 5 real entries and 25.00 USD of expected
fees, and it does so silently under a reconciliation that would then agree with itself.

**Use the entry uuid as the label.** Unique by construction, but it puts a 36-character identifier in
a field the model describes as the human-facing distinguisher, and it relabels all 46 entries rather
than the 5 that are ambiguous.

**Relax the unique index.** Rejected on principle: the index is the control that stops an accidental
duplicate becoming a second obligation. Weakening a control to make a load pass is exactly what the
charter's security rule forbids.

**Escalate to the operator.** Considered and rejected as a misclassification. The operator cannot
recover a label that was never recorded — the source has no label data at all — so the question has no
answer to give. Blocking the whole money spine on an unanswerable question would stop work that the
evidence can complete.

**Ordinal by `created_at`.** Rejected in favour of sorting by `pool_entry_id`: `created_at` is nullable
in the legacy data, and a null-bearing sort key produces unstable labels across runs.

## Why the suffix is assigned over SORTED records

The suffix must depend on the SET of entries, not on the order the JSON document happened to list them
in. A backfill is re-run — after a crash, during a rehearsal, at cutover — and a participant whose
label changed between two runs would break the idempotent write and appear as a new entry. Sorting by
`pool_entry_id` before assigning makes the output identical for any serialisation of the same pool.
This is asserted by test, not assumed.

## Why the two severities differ

A defaulted collision means the source never carried a label to disagree about — the migration is
supplying information nobody ever recorded, which is a WARNING. An explicit collision means a human
typed the same label twice, so the distinction the model relies on genuinely was not recorded and
someone should look at it: CONFLICT. Both still preserve the row; the severity changes who is told,
not what is written.

## Tests that prove it

`scripts/db/test_transformers.mjs` (76 passed):

- two unlabelled entries by one participant get distinct labels and neither is dropped
- `(identity_key, pool_id, entry_label)` is unique across every emitted record
- labels are identical when the document's `entries[]` array is reversed
- two explicitly identical labels report CONFLICT, not WARNING
- disambiguation never steals a suffix another entry already claims explicitly
- no `__`-prefixed internal bookkeeping field survives into an emitted record

End-to-end, against real PostgreSQL with real legacy data
(`b_backfill_real_pg.mjs`): all 46 real entries load, reconciliation COMPLETE, 5 disambiguations
reported.

## How to reverse it

Delete `disambiguateEntryLabels` and its call site; the transformer returns to defaulting every blank
label to `"main"`. The 5 affected rows can be relabelled in place — the suffix pattern
`^(.*)-(\d+)$` identifies exactly the rows this rule created, and the finding list names each
`entry_id`. Reversal reintroduces KPLUS-F016.
