# Default privileges — what local PostgreSQL proves, what it cannot, and the Supabase verification plan

**Created 2026-08-11.** Companion to `scripts/db/privilege_model.mjs`, `privilege_evidence.mjs` and
`surface_inventory.mjs`. Design only — **no production privilege was changed.**

---

## 1. The root cause in one paragraph

Supabase's bootstrap runs `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES / SEQUENCES / FUNCTIONS TO anon,
authenticated, service_role` in `public`. Every relation created in that schema — by *either* migration
channel (ADR-K10), by a CLI push, by a `db query`, by anyone — inherits full CRUD for the anonymous
browser role, and no SQL in either repository asks for it. `bolao/shared/sql/015` and `024` grant only
`SELECT` on their views; the write half arrived on its own. That is KPLUS-F058, and KPLUS-F055's
`bolao_notif_jobs` exposure, and it is why privileges are now generated from an explicit model instead of
inherited from a platform default nobody wrote down.

---

## 2. Where a privilege can come from

| source | example here | remedy |
|---|---|---|
| PostgreSQL built-in | `EXECUTE` to `PUBLIC` on every new function | an **unrestricted** `ALTER DEFAULT PRIVILEGES … REVOKE` — see §4 |
| Platform (Supabase) default | `ALL` on tables to anon/authenticated/service_role in `public` | `ALTER DEFAULT PRIVILEGES` per creator role |
| Explicit `GRANT` | `grant select on bolao_state_public to anon` (shared/sql/015) | `REVOKE` on the object |
| Default-privilege inheritance | anon's CRUD on both views | altering the default fixes FUTURE objects only |
| Migration-generated | the target schema's grants — there are none, which is its own finding | the generator |

These are kept apart because **the remedy differs for each**, and because "anon can write this" is not one
fact but five different ones with five different fixes.

---

## 3. `ALTER DEFAULT PRIVILEGES` is per creator role

`ALTER DEFAULT PRIVILEGES [FOR ROLE x] …` affects only objects created **by x**. Altering `postgres`
changes nothing about objects created by `supabase_admin`.

This is the trap the design is shaped around. A remediation that alters one role's defaults and declares
the class fixed will pass **every local test whose fixtures are created by that same role** — and leave
every other creator inheriting the blanket grant. `NIGHT-28` N28-4 proves it against a server: after
covering one creator, a table created by a *second* creator inherits all seven privileges again, and
covering that creator too is what closes it.

Production's creator roles are **not confirmed**. `pg_default_acl` has never been read there. So
`CREATOR_ROLES` marks `postgres` confirmed (it owns every relation the probe saw) and `supabase_admin` /
`supabase_migrations` **UNCONFIRMED**, and the generated SQL carries that marker inline.

---

## 4. KPLUS-F059 — a schema-scoped revoke cannot remove PUBLIC's `EXECUTE`, and fails silently

Measured on PostgreSQL 17.10 by NIGHT-28's canary, not taken from documentation:

```
ALTER DEFAULT PRIVILEGES FOR ROLE x IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  → no pg_default_acl row is created.
  → a function created afterwards still carries =X/owner.
  → a probe role can still execute it.
  → the statement returns success.

ALTER DEFAULT PRIVILEGES FOR ROLE x REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;    -- no IN SCHEMA
  → a row IS created (defaclnamespace NULL).
  → PUBLIC loses EXECUTE on new functions.
```

PostgreSQL's built-in `EXECUTE`-to-`PUBLIC` is a **database-wide** default, so a schema-restricted default
ACL has nothing to subtract it from.

This is the exact class of defect a SQL review cannot catch: valid statement, success, no effect. Only
creating an object afterwards reveals it — which is what the canary is for.

**Consequence, stated rather than hidden:** the working form is not restricted to `public`. It covers every
schema that creator makes functions in. That is deliberate — PUBLIC should hold `EXECUTE` nowhere by
default — but it is a wider blast radius than the rest of the block, and the generated file says so.

---

## 5. What local PostgreSQL proves, and what it cannot

### Proven locally (NIGHT-28, 15/15)

- the blanket-inheritance posture reproduces exactly: a new table gives anon all seven privileges;
- the generated `ALTER DEFAULT PRIVILEGES` stops that — canary table, **view** and function all inherit nothing;
- the per-creator-role trap is real and the per-role remedy closes it;
- forward SQL brings existing objects to target; **rollback restores the measured prior state exactly**;
- the verification query detects an injected `anon INSERT` (anti-vacuity);
- the surface inventory queries all 19 classes, with empties recorded as `MEASURED_EMPTY`;
- KPLUS-F059.

These are facts about **PostgreSQL**, and Supabase is PostgreSQL. They transfer.

### NOT proven locally — and this is the honest boundary

Local PostgreSQL **cannot** prove Supabase's default-privilege behaviour, because the platform may inject
grants this cluster never sees:

1. **The actual `pg_default_acl` contents in production have never been read.** The mechanism modelled
   here is inferred from Supabase's documented bootstrap plus the observed effect. Well supported;
   still an inference.
2. **Which creator roles own those defaults is unknown.** Decisive, per §3.
3. **The platform may re-apply its defaults.** Supabase manages roles and grants through its own tooling; a
   platform upgrade, an extension install, or a dashboard action could reinstate what we revoke. Nothing
   local can tell us whether it does.
4. **`supabase_admin` and the dashboard operate outside the migration path entirely** — ADR-K10 is the
   proof that a second channel exists, and the platform is arguably a third.
5. **PostgREST's schema cache** decides what is *reachable* over the API independently of SQL privileges.
   A revoke that is correct in the catalog can still leave a stale route until the cache reloads — which
   is exactly what the `pgrst_ddl_watch` event trigger exists to handle.
6. **TRUNCATE / REFERENCES / TRIGGER, all sequence privileges, and every function's `EXECUTE` but one**
   were never measured in production.

> **Local green does not mean the platform agrees.** Claiming otherwise would repeat KPLUS-F039 exactly:
> a property measured on a rehearsal asserted about production.

---

## 6. The Supabase-target verification plan (feeds GNG-2)

To be run against a **disposable Supabase project**, never production. Each step names what would make it
fail, because a verification that cannot fail verifies nothing.

| # | step | fails if |
|---|---|---|
| S-1 | Create a scratch project. Read `pg_default_acl` **before touching anything**. | the platform's defaults differ from the model in §1 — in which case the whole remediation is aimed at the wrong target |
| S-2 | Record `defaclrole` for every row. | a creator role appears that `CREATOR_ROLES` does not list; per §3 that role's objects would keep inheriting |
| S-3 | Apply `PRIVILEGE_DEFAULTS.draft.sql`, retargeted at the creator roles S-2 actually found. | any statement errors, or any creator is left uncovered |
| S-4 | **Canary:** create a table, a view and a function *through each channel* — CLI migration, `db query`, and the dashboard SQL editor. | any canary inherits a browser-role privilege. Three channels because each may run as a different role, and §3 says that decides everything |
| S-5 | Confirm PUBLIC cannot execute the canary function (read the ACL, not `has_function_privilege` — PUBLIC is a pseudo-role). | KPLUS-F059's fix does not hold on the platform |
| S-6 | Exercise the PostgREST API with the anon key against each canary. | a route still permits a write the catalog says is revoked — the schema-cache gap in §5.5 |
| S-7 | Trigger a platform action that touches grants (extension install; a dashboard table creation), then re-read `pg_default_acl`. | **the platform reinstates its defaults.** This is the single most important step and the one no local rehearsal can substitute for |
| S-8 | Apply `PRIVILEGE_ROLLBACK.draft.sql`; confirm the effective matrix returns to the S-1 measurement. | rollback is not exact on the platform |
| S-9 | Take a backup, restore into a *second* scratch project, and re-run the effective-privilege comparison plus the event-trigger companion check. | privileges or event triggers do not survive a platform-to-platform restore — the GNG-2 criterion itself |

**S-9 is the GNG-2 step.** GNG-2 requires an operator-performed restore against production-shaped data on a
Supabase target; S-1 through S-8 make that restore meaningful by establishing what the privileges were
supposed to be. Until S-9 runs, **GNG-2 stays NO regardless of how green the local suite is.**

---

## 7. What is deliberately not done

- **No production privilege changed.** Every artefact is `NOT FOR PRODUCTION APPLY`.
- **No instrumentation deployed.**
- **No production read performed** — this work was authorized for local design only. The four queries that
  would close the remaining gaps are prepared in `CONSOLIDATED_READ_PACKAGE` and have **not** been run.
- **`anon`'s CRUD on `bolao_notif_jobs` not revoked.** Generated and rehearsed; applying it is the
  product's decision (ADR-K10 D-6).
