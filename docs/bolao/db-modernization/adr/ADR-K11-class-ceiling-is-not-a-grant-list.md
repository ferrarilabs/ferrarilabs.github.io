# ADR-K11 — TARGET_POLICY.TABLE is a class CEILING, not a per-table grant list

**Status:** ACCEPTED · **Date:** 2026-08-11 · **Classification:** YELLOW (autonomous, ADR required)
**Context:** PRODMIG-Q19, trusted-runtime grants on the 26 normalized relations.

## Decision

`targetPrivileges("TABLE", "service_role", <relation>)` now intersects the class ceiling from
`TARGET_POLICY.TABLE` with what `model/rls_model.json` actually authorizes the trusted runtime to do for
that specific entity, derived at call time via `rls.mjs` `operationMatrix()`.

The class ceiling itself is unchanged: `["SELECT","INSERT","UPDATE","DELETE"]` remains what a table of
this class *may* ever hold. What changed is that it is no longer read as what every table *does* hold.

## Why

Q19 measured the live effective privileges on all 26 relations first: **0 of 546 cells held anything**,
and `service_role` held only schema USAGE. So the package would be pure GRANT, and whatever it granted
would be the entire access model — there was nothing to subtract.

Read as a per-table grant list, `TARGET_POLICY.TABLE` over-grants in three distinct ways. All three were
measured against the model, not argued:

| over-grant | scope | what the model says |
|---|---|---|
| DELETE | **all 26 entities** | `rls_model.json` has `noDeleteAnywhere: true`, contains **zero** DELETE policies (its commands are SELECT/INSERT/UPDATE only), and `write_contracts.mjs` does not mention DELETE once |
| INSERT | `audit_chain_head` | the row is seeded by M8 and thereafter only UPDATEd by the chain trigger; nothing inserts it |
| UPDATE | `audit_events`, `ranking_snapshots`, `classification_snapshots`, `competition_edition_standings`, `outbox_delivery_attempts`, `request_idempotency` | append-only entities |

That is **33 privileges the architecture authorizes nowhere.**

### Why this is not a cosmetic tidy-up

`service_role` holds **BYPASSRLS** in production. Measured this session, and re-measured as a negative
control: with SELECT granted it reads through RLS and sees rows.

So for `service_role` the row-security layer is not a second line of defence — it does not apply at all.
The absence of a DELETE *policy* protects nothing. A granted DELETE would be an unrestricted destructive
capability over `payments`, `payment_allocations`, `prize_allocations` and `audit_events` — the precise
tables this programme exists to keep intact — held back only by the fact that no code currently issues
one. **The GRANT is the only control, so the GRANT is where least privilege has to be real.**

The same reasoning applies to UPDATE on the append-only entities. `audit.refuse_mutation()` blocks those
mutations at the trigger layer, which is a genuine control — but it is one the runtime's own privilege
would otherwise be arguing against, and a trigger can be dropped by whoever owns the table.

## Alternatives considered

1. **Grant the full ceiling anyway** — "the policies deny it, so the grant is inert." This is exactly the
   argument KPLUS-F036 records sitting in production: six tables with full CRUD to anon, held off only by
   RLS enabled with zero policies. `detectRlsSubstitution()` exists in this same file to refuse that
   argument. It is worse here, because BYPASSRLS means the grant is not even inert.
2. **Hardcode a denylist** (`never grant DELETE`) — rejected. A denylist keeps saying "no DELETE" after
   the authorization model legitimately changes, so the detector stops tracking the thing it detects.
   There is a test asserting the narrowing is derived rather than hardcoded.
3. **Compute the intersection in the campaign script instead of the model** — rejected. Q19's brief is to
   use only the canonical generated package; computing targets outside `privilege_model.mjs` would make
   the generated artefact no longer describe what was applied.
4. **Grant DELETE only on non-financial, non-audit tables** — rejected as an invented middle position.
   The model authorizes DELETE on zero entities; "some" is not a reading of that.

## Evidence

- Live measurement: `production-migration/PRODMIG-2026-08-11-A/q19/MEASURED_CURRENT_PROD.json`,
  matrix sha256 `9f91a618640ea944…`, 26 relations × 3 roles × 7 verbs = 546 cells, all false.
- `model/rls_model.json`: `noDeleteAnywhere: true`; `policies[].command` ∈ {SELECT, INSERT, UPDATE}.
- `rls.mjs operationMatrix()`: 0 entities with `trusted_runtime` DELETE at ALLOW/TRUSTED_RUNTIME_ONLY.
- `service_role.rolbypassrls = true` in production (`pg_roles`, 2026-08-11).

## What changed

`scripts/db/privilege_model.mjs` — added `runtimeRequiredPrivileges()` and the intersection inside
`targetPrivileges()`, applied **only** to `objectClass === "TABLE"`, `role === "service_role"`, and
relations in `bolao`/`audit`. Browser roles were already empty and are untouched. Legacy `public`
relations remain governed by `LEGACY_COMPATIBILITY_EXCEPTIONS`. A direct import of `rls.mjs` was added;
there is no cycle (`rls.mjs` imports `validate_access_model.mjs` and nothing from here).

## Tests that prove it

`scripts/db/test_privilege_model.mjs`, four new cases:

- no target relation grants the runtime DELETE, checked per entity per schema;
- append-only entities get no UPDATE, `audit_chain_head` gets no INSERT;
- the narrowing applies only to the runtime on target schemas — browser roles and the bare class ceiling
  are unchanged;
- a MUTANT case asserting the narrowing is derived: `payments` must still carry the three privileges the
  model *does* authorize, so this is narrowing rather than blanket denial.

**Mutation-tested.** Reverting the intersection to a no-op makes two of the four fail. Gates 50/50.

## How to reverse it

Delete the intersection block in `targetPrivileges()` and the `rls.mjs` import. The class ceiling is
untouched, so behaviour returns exactly to the prior blanket list. If a future write contract genuinely
needs DELETE on a specific entity, the correct change is to add the DELETE policy to `rls_model.json` —
the narrowing will then pick it up automatically, which is the point of deriving it.
