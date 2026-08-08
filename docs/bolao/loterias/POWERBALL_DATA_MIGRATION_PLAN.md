# Powerball Admin — Data Migration Plan (data.js → Supabase)

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado**.

## Tool (testado e executado — dry-run only, no network)

`scripts/powerball/import_data_to_supabase.mjs`. Reads `bolao/loterias/powerball/js/data.js` by
running it in a Node `vm` sandbox (no network, no writes, does not touch the real `window`),
normalizes the `*_DRAWS` arrays it finds, and prints counts + two hashes. It never opens a
Supabase connection — there is no code path in the script that can write anywhere. It was run
for real in this sandbox; output below is the actual output, not a fabricated example.

## Real dry-run output (captured just now)

```
=== Powerball data.js -> Supabase — DRY RUN (no writes performed) ===
source_data_hash (sha256 of raw file): 0ef9c40c2b3d044a41b5df5a16e2d0c2f72e4961a2f112829b2d3590166b93c6
imported_data_hash (sha256 of normalized dry-run output): 20a1a25c9b4032c730a74f7e4e3e1ef84a6688cf9e106c6658cc2091d7b54e41
draws found: 2
participant rows found (sum across draws, not deduplicated by person): 28
ticket rows found (sum across draws): 0
payment total found (sum of 'valor' fields, USD): 418.00
```

## Interpretation

- **2 draws** are currently in `data.js` (`window.POWERBALL_DRAWS`).
- **28 participant rows** summed across both draws — this is *not* deduplicated by person; the
  same real person (e.g. Eduardo Ferrari, Marcus Steffenon, Gustavo Bossle) appears once per
  draw they contributed to, so the real distinct-participant count is lower than 28. A real
  import would need to deduplicate by email (or a manually-reviewed match) into
  `lottery_participants`, with one `lottery_participations` row per draw they're in — this
  matches the participants/participations split described in POWERBALL_ADMIN_ARCHITECTURE.md.
- **$418.00** total across the `valor` fields found — this is a real financial figure from real
  (not synthetic) production data in `data.js`, since this repo's Powerball pool is live money.
  This number has NOT been independently reconciled against Zelle/Venmo/CashApp records in this
  pass — it is exactly what's typed into `data.js` today, nothing more.
- **0 ticket rows** — confirmed by direct grep that `data.js` has no `tickets:` key at all;
  ticket numbers are rendered from elsewhere in the app (not `data.js`), so a real migration
  needs a separate source-of-truth investigation for ticket data before `lottery_tickets` can be
  populated. Not guessed at here.

## Differences vs. new schema (validado estaticamente)

| data.js field | Target table.column |
|---|---|
| `draws[i]` | `lottery_draws` (one row per draw) + `lottery_pools` (pool likely needs to be created once, draws reference it) |
| `participants[i].name/email/state` | `lottery_participants` (dedup by email) |
| `participants[i].cotas` | `lottery_participations.cotas` |
| `participants[i].valor` | `lottery_payment_transactions` (type = `contribution`) |
| `participants[i].txId` | `lottery_payment_transactions.external_reference` (never exposed publicly) |
| `participants[i].status` (organizador/verificado) | not a 1:1 column — needs a decision: fold into `lottery_participations.state` or drop (organizer flag may belong on `lottery_admin_roles` instead, since Eduardo is also the owner) |
| tickets (numbers shown in UI) | source not found in `data.js` — needs separate investigation before a `lottery_tickets` import can be written |

## Rollback plan

Since this migration has never been executed (dry-run only), there is nothing to roll back. If
a future real import is run: (1) the import script must be extended to tag every inserted row
with a `source = 'migration'` audit entry (already supported by `lottery_admin_audit.source`),
so an operator could identify and archive (never hard-delete, per the no-hard-delete rule)
every row created by a specific migration run via its `correlation_id`. (2) `data.js` itself is
never deleted by this tool — it remains the fallback source of truth until Supabase is
confirmed correct.

## Confirmation status

No confirmation to actually import was given or requested in this pass. The tool has no
"proceed" flag implemented — running it always stops at the dry-run report. Building the actual
write path (with the require-explicit-confirmation gate) is future work, tracked here rather
than silently implemented and left unused.
