<!-- FDC-20260813-140645Z · no raw PII -->

# RUNTIME OPERATIONAL PROVENANCE

`NORMALIZED_RUNTIME` records do not belong in `audit.migration_lineage`. This is where their
provenance lives instead.

## The discriminators — discovered per domain, not assumed

| Domain | Discriminator | Runtime records |
|---|---|---:|
| predictions | `bolao.predictions.mirrored_at IS NOT NULL` | **0** |
| entry content | `pool_entries.content_updated_at` **after** 2026-08-13T13:1xZ | **0** (max is `2026-08-13T00:28:27Z`, pre-cutover) |
| phases / schedule / topology | `public.bolao_state['cdb2026'].updated_at` movement + an `auditLog` record with `source: server-rpc` | **1** — the operational canary at `2026-08-13T13:23:09Z` |
| delivery obligations | `bolao.outbox_events.created_at` | **6 total**, newest `2026-08-13T07:46:59Z` (powerball), **0 after the cutover** |
| platform events | `audit.audit_events.occurred_at` | **28 total**, newest `2026-08-13T13:39:44Z` (`draw.outbox_reconciled`, powerball) |
| notifications | `public.bolao_notif_jobs` | 25 (br2026 + powerball) |
| token use | `public.cdb_entry_access.last_used_at` | **3 tokens used**, newest `2026-08-13T14:04:34Z` |

**`mirrored_at` is not the only discriminator** and was not treated as one: entry content has
`content_updated_at`, operator mutations are visible through the document's `updated_at` plus the
audit record's `source`, and delivery has its own `created_at`. Each was checked separately.

## The 2026-08-13T14:04:34Z token use

Two minutes before this audit opened, entry token `bfb1573d…` was exchanged. It is **access**
provenance, not a business write:

- `predictions.mirrored_at` = **0** — no prediction was written.
- The cdb2026 document's last write is still the canary at `2026-08-13T13:23:09Z`.
- No `outbox_events` row was created after `07:46:59Z`.

So a participant (or their browser) opened their entry and did not save. Recorded here rather than
in the stabilization tracker, because `last_used_at` is not a save and **must not be allowed to
inflate `NATURAL_CDB_SAVES_OBSERVED`**.

## Outbox — corroboration, not business facts

| Event type | Status | Created | Payload keys |
|---|---|---|---|
| `cdb2026.picks_open_invitation` | sent (2 attempts) | 2026-08-12T16:43:06Z | `cutoffAt, phaseId, recipientCount` |
| `cdb2026.access_correction` ×3 | sent | 17:18 / 17:22 / 17:30 | same |
| `cdb2026.entry_saved_confirmation` | sent | 2026-08-13T00:22:14Z | `entryId, picksVersion, savedAt` |
| `powerball.draw_result` | sent | 2026-08-13T07:46:59Z | `drawId, expectedRecipients` |

**No payload carries an address.** `audit.audit_events` carries `recipientHash`, never a raw
recipient. The two retry attempts on the invitation event are **one** business obligation — a
transient technical retry is not an independent business fact and is not counted as one.

## Coverage

```
NORMALIZED_RUNTIME business records                 0
runtime records with operational provenance         0 / 0     → 100.000%
runtime records wrongly written to migration lineage 0
RUNTIME_PROVENANCE_COVERAGE_PERCENT               100.000
```

The coverage is 100% over a denominator of zero, and saying so plainly is more useful than a
number that hides it: **the runtime path has not yet been exercised by a real participant save.**
That is a stabilization gap, tracked separately, not a lineage gap.
