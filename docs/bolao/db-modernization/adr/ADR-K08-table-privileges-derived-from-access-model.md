# ADR-K08 — table privileges, derived from the access model

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F029 · Found and resolved on the way: KPLUS-F031, KPLUS-F032, KPLUS-F033 (lab vacuity)
Governs: `scripts/db/rls.mjs` (`deriveGrants`, `renderGrantSql`, `renderTargetAclSql`, `entitySchemas`,
`qualify`, `entityColumns`, `predicateColumns`, `lintPolicies`), `model/target_model.json`
(`ranking_snapshots.published_at`), `docs/bolao/db-modernization/rls-drafts/TARGET_RLS.draft.sql`

## Decision

Table privileges are **derived from `model/access_model.json`**, rendered into the same artefact as the
policies, and applied after them. Four rules, each of which could have gone another way:

1. **`SELECT_OWN` becomes `GRANT SELECT`.** PostgreSQL has no row-scoped GRANT; row scoping is what the
   ownership policy does. The grant and the policy are one mechanism — the grant makes the table
   reachable, the policy decides which rows come back.
2. **`operator` receives no grant.** R-GAP-1: it is not a database principal. Its permissions are
   exercised as `service_role`, which is sound only because operator ⊆ service on all 25 entities —
   **checked by the generator, which throws if it is ever untrue**, not assumed.
3. **No `DELETE` is granted anywhere.** Nothing in this schema is deleted and no entity declares it.
4. **`REVOKE ALL … FROM PUBLIC` precedes every grant**, so the statement set is idempotent and cannot
   leave behind a privilege an earlier run gave and the model no longer declares.

## The problem

The migration emitted **no `GRANT` anywhere** — not one, across twenty-five tables. That looks like a
conservative default and is a non-functional one, because of a category error worth naming plainly:

> **A row-level policy grants nothing.** RLS filters rows among the privileges a role already holds. A
> table with a permissive `SELECT` policy `USING (true)` and no `GRANT SELECT` denies everyone, exactly
> as if the policy were absent.

So the target schema, as generated, was reachable by no application principal. Measured three times
independently: `m_rls_acl_lab` M10 reported `service_role SELECT on bolao.participants: ACL_DENIED`; the
KPLUS-F027 lab could not make its runtime do anything until it granted by hand; and F029-3b now applies
the policy half alone and watches all four probe principals be refused `permission denied`.

## Why this was not an operator question

The grants are *derived from a ratified model*, not chosen. `access_model.json` has declared the intended
per-principal permissions for every entity since it was written; nothing here decides who may do what, it
makes the database agree with what was already decided. Business, financial and scoring meaning are
unchanged. PII exposure is unchanged **and asserted**: F029-4c checks 207 undeclared privileges and finds
none granted, and F029-5c confirms no browser principal can reach money or the audit log. Production is
untouched, and the change is reversible by regenerating from the previous model.

## Two defects that blocked the proof, both in the same artefact

**KPLUS-F031 — the RLS draft named three tables in the wrong schema.** `renderPolicySql` wrote `bolao.`
in front of every entity. Twenty-two of twenty-five are in `bolao`, which is precisely why the three in
`audit` went unnoticed. Applying the draft aborted at `bolao.audit_chain_head` with `relation does not
exist`. It fails closed rather than mis-targeting a real table, but the consequence is the same class as
KPLUS-F028: M8 creates the audit spine with FORCE RLS and zero policies, so a policy step that does not
complete leaves the audit log unreachable by everyone.

*The test asserted the defect.* `test_rls.mjs` checked `ALTER TABLE bolao.${e} ENABLE ROW LEVEL SECURITY`
for every entity, so the gate agreed with the bug. Both now take the schema from `target_model.json`.

**KPLUS-F032 — two policies filtered on a column that does not exist.** `ranking_snapshots_anon_select`
and `..._authenticated_select` used `published_at IS NOT NULL`; `bolao.ranking_snapshots` never had a
`published_at`. `CREATE POLICY` refuses an unknown column, so the draft aborted there and **everything
after it never ran** — the rest of the policies, and the entire privilege section.

### The KPLUS-F032 resolution, and a wrong turn worth recording

The first attempt relaxed the predicate to `TRUE`, reasoning from product evidence: all three apps render
the participant ranking publicly today, so a publication gate would dark a live page. That change made
two existing tests fail — one of them a mutation-tested security assertion, *"only PUBLISHED ranking
snapshots are public; drafts are not"*.

**That was the control working, and rewriting it to match the change would have been weakening a gate to
maintain momentum.** Two artefacts stated the intent (the policy's own rationale and the security
assertion); only an inference about app behaviour said otherwise. The change was reverted.

*Chosen instead:* **add the column the model already assumed.** `ranking_snapshots.published_at
timestamptz NULL`. NULL means draft and is visible to no browser principal; a timestamp publishes it.
This makes the existing predicate literally true, keeps the existing security assertion passing
unchanged, is fail-closed, and touches an empty table — M10 has never run.

*Alternatives rejected:*
- *`TRUE`* — as above. Widens visibility to a decision the model never took, and required deleting a
  security test to pass.
- *Gate on `is_provisional`* — worse, and instructively so. The BR2026 projection model requires
  provisional standings to be **shown and labelled as projections**, never hidden. Provisionality is a
  *presentation* contract; publication is an *access* one. Conflating them would have used the access
  layer to enforce a UI rule and broken the projection page.

**Flagged for the operator, blocking nothing:** with the column added and no publish step written, a
ranking is invisible to browsers until something sets `published_at`. That is the fail-closed direction
and matches the model, but if the intent is "rankings are public the moment they are computed", the fix
is a one-line predicate change here plus retiring the security assertion deliberately. Queued as
`F032-PUBLISH-GATE`.

## The gate that would have caught it

`lintPolicies` checked policy names, principals, commands, rationales and coverage — every property of a
policy except whether the thing it filters on is real. It now takes a column map and raises
`POLICY_COLUMN_NOT_IN_MODEL` for any predicate naming a column the target model does not declare, at any
depth inside `AND`/`OR`/`NOT`. This turns "the draft is well-formed" into "the draft can be applied".

## KPLUS-F033 — the lab's own vacuity, caught before it was believed

The first version of `f029_grants_acl_lab.mjs` connected to each principal directly. `anon`,
`authenticated` and `service_role` are NOLOGIN — as they are in Supabase, where PostgREST connects as
`authenticator` and `SET ROLE`s per request — so every connection failed with `FATAL: role "anon" is not
permitted to log in`, and **four "the principal is denied" assertions passed on that refusal.**

Fixed two ways: the lab uses `SET ROLE`, matching the platform; and every denial now goes through a
`denied()` predicate that requires a *privilege* refusal and explicitly rejects `FATAL`, `does not exist`
and login failures. Fourth instance of the KPLUS-F024 pattern in this campaign — a control that reports
success because its probe never ran.

## Evidence

| Claim | Where |
|---|---|
| All twelve migration drafts apply to a fresh database, producing 25 tables, all FORCE RLS | F029-1a/1b |
| No application principal is a superuser or holds BYPASSRLS | F029-2a |
| KPLUS-F031/F032 — the policy half now applies completely, all 93 policies | F029-3a |
| **Policies applied, grants withheld: every principal denied on every table** | F029-3b |
| Every one of the 93 declared privileges is actually held | F029-4b |
| None of the 207 undeclared privileges is held, DELETE included | F029-4c |
| PUBLIC holds nothing on any of the 25 tables | F029-4d |
| anon can now read a reference table it could not read in F029-3b | F029-5a |
| The grant makes the table reachable; the ownership policy still returns 0 rows | F029-5b |
| No browser principal reaches money or the audit log | F029-5c |
| service_role writes; anon cannot write the table it can read | F029-5d/5e |
| A real audit append by service_role — schema USAGE + table grant + F028 function grant + policy | F029-6a/6b |
| The audit schema is reachable only by the runtime | F029-6c/6d |
| operator produced no grant, and the generator refuses if operator ⊄ service | F029-7a, test_rls |

Fingerprints: `fingerprints/F029_grants_acl.json` (22/22). Repo: `node scripts/gates.mjs` 45/45 over 33
suites; `test_rls.mjs` 108 tests, 2115 assertions, 14/14 mutants killed. Target re-verified after the
schema amendment: `a15_verify_target_model` 0 unexplained differences, `c_catalog_fidelity` 524
comparisons 0 defects. Regression: B money spine 29/29, F014 27/27, F023 12/12.

## How to reverse it

Drop `renderGrantSql`/`deriveGrants` from `renderTargetAclSql` and regenerate: the draft returns to
policies only, and F029-3b's state becomes the permanent one — a schema no application principal can
reach. The KPLUS-F031 schema fix and the KPLUS-F032 lint must **not** be reverted with it; both are
independent of the grant decision and each blocks the draft from applying at all.
