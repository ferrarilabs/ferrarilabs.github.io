# Deployment-time substitution mechanism

**STATUS:** DESIGN. **Never executed.** Nothing in this directory has been applied anywhere.

The committed baseline is a `.template` because three policy literals must not enter Git
(`PRIVATE_LITERALS.md`). This is how it becomes executable **at the moment of use**, without those
values ever being written to a tracked file.

## Mechanism — psql variables from the private capture

The template references `:'policy_literal_1'`, `:'policy_literal_2'`, `:'policy_literal_3'`
(19 occurrences, 3 distinct values). psql substitutes single-quoted variables safely.

```
# Values are read from the PRIVATE capture, outside Git, at run time.
# They are never echoed, never logged, never written to a tracked path.
PRIV=~/Documents/GitHub/ferrarilabs-work/db-modernization/ddl-baseline-<UTC>/raw

psql --set=ON_ERROR_STOP=1 \
     --set=policy_literal_1="$(read_from "$PRIV" 1)" \
     --set=policy_literal_2="$(read_from "$PRIV" 2)" \
     --set=policy_literal_3="$(read_from "$PRIV" 3)" \
     -f supabase/migrations/BASELINE_current_production_state.reference.sql
```

**Constraints on any implementation of `read_from`:**
- must not write the value to a file inside any Git working tree;
- must not echo the value to stdout/stderr or into shell history;
- must not pass the value as a bare command-line argument (visible in `ps`) — `--set=` is acceptable
  because psql consumes it directly, but an env-var or stdin form is preferable in shared environments;
- must fail closed if the private capture is unavailable.

## Why the Supabase CLI is NOT used for this file

`supabase db push` applies `*.sql` in `supabase/migrations/`. This file is deliberately named so the CLI ignores it, so the CLI **will not pick it up** — which is the intended safety property: a
non-executable baseline cannot be applied by accident. Converting it to `.sql` is a deliberate act
requiring either option A (policy redesign) or option B (operator lifts the restriction) from
`PRIVATE_LITERALS.md`.

## Preferred long-term answer

**Retire the dependency instead of managing it.** Under the target architecture the six legacy
policies are replaced by identity-aware authorization in Edge Functions (E3), and base tables move
out of `public` (E1). At that point the baseline's only private dependency disappears and the file
can become a plain, fully executable `.sql`. Deployment-time substitution is a bridge, not a
destination.

## Restore rehearsal note

The rehearsal restores from the **`pg_dump` archive**, not from this template. The archive contains
the real policy definitions and is encrypted at rest. This template plays **no part** in the restore
rehearsal — it exists for reproducibility and audit, not recovery.
