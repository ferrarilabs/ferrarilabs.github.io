# RLS ASSUMPTIONS REVIEW — documented, not changed

**Status:** REVIEW ONLY. No policy, grant, or ownership was modified by this document.
**Basis:** Phase 1 `S11`, `S11b`, `S14e`, `S14f`, `S21a`, `S21c`, `S21d`, `S21e`, `S21f`
+ Phase 1B event-trigger and database-ACL evidence.

> **Hard methodological rule applied throughout.** An RLS conclusion is only valid when crossed
> with (a) role attributes (`BYPASSRLS`, `SUPERUSER`), (b) table grants, (c) schema `USAGE`, and
> (d) `FORCE RLS`. Policy facts alone prove nothing. Every claim below states its crossing.

---

## 1. The effective access model, as it actually is

### 1.1 Roles that make RLS irrelevant

| Role | SUPERUSER | BYPASSRLS | LOGIN | Meaning |
|---|---|---|---|---|
| `supabase_admin` | ✅ | ✅ | ✅ | Total access. Platform-owned. |
| `postgres` | ❌ | ✅ | ✅ | **Bypasses all RLS.** This is the role the operator/tooling connects as. |
| `service_role` | ❌ | ✅ | ❌ | **Bypasses all RLS.** Reachable via the service API key. |
| `supabase_etl_admin` | ❌ | ✅ | ✅ | Bypasses RLS. |
| `supabase_read_only_user` | ❌ | ✅ | ✅ | Bypasses RLS. |

**Assumption to retire:** "RLS protects the data." For five roles it does not apply at all. RLS
protects against `anon` and `authenticated` only. Any threat model that treats RLS as the primary
control must name which principal it is controlling.

### 1.2 The gate that makes grants exercisable

`PUBLIC` holds `USAGE` on schema `public` (`S21c`). Therefore every table grant to `anon` /
`authenticated` **is** exercisable — there is no schema-level brake. Confirmed, not assumed.

### 1.3 Grants on the 7 application tables

All 7 carry **explicit, non-default** ACLs granting `SELECT, INSERT, UPDATE, DELETE, REFERENCES,
TRIGGER, MAINTAIN` to `anon`, `authenticated`, **and** `service_role` — the signature of a
blanket `GRANT ALL ON ALL TABLES IN SCHEMA public`. `TRUNCATE` was also granted until the
authorised remediation removed it from `anon` on these 7 (2026-08-07).

**Assumption to retire:** "the grants are the Supabase defaults, so they are fine." They are the
Supabase *template*, which is designed on the premise that **RLS carries the whole load**. That
premise only holds where policies exist. See §2.

---

## 2. Per-table reality

| Table | RLS enabled | FORCE RLS | Policies | Effective posture for `anon` |
|---|---|---|---|---|
| `bolao_state` | ✅ | ❌ | **6** | Read + insert + update permitted under policy conditions |
| `lottery_admin_audit` | ✅ | ❌ | **0** | **Default deny** (all DML blocked) |
| `lottery_draws` | ✅ | ❌ | 0 | Default deny |
| `lottery_participants` | ✅ | ❌ | 0 | Default deny |
| `lottery_participations` | ✅ | ❌ | 0 | Default deny |
| `lottery_payment_transactions` | ✅ | ❌ | 0 | Default deny |
| `lottery_pools` | ✅ | ❌ | 0 | Default deny |

Zero tables show `policies_defined_but_rls_off` — there is **no inert-policy trap**, which is the
most dangerous RLS misconfiguration and is confirmed absent.

### 2.1 Why the six lottery tables are protected by accident, not by design

They are default-deny because they have **no policies**, and they have no policies because
`002_rls.sql`'s 13 policies were **never applied** (`DATABASE_RECONCILIATION.md` §3.2). RLS itself
is enabled not by deliberate act but by the undeclared `ensure_rls` event trigger, which
auto-enables RLS on every newly created table (Phase 1B §5).

So the current safe posture is the product of two unintended facts: a migration that did not run,
and an event trigger nobody documented. **It is correct today and fragile forever.** The moment
someone applies `002_rls.sql`, six tables move from default-deny to policy-governed in one step,
and those policies have never been reviewed against production reality.

### 2.2 `bolao_state` — the only genuinely policy-governed table

Six permissive policies for `anon`: 2 × SELECT, 2 × INSERT, 2 × UPDATE (duplicated names suggest
two generations of policy applied without cleanup).

Structural facts from `S11` (expressions deliberately not extracted):

- `using_is_unconditional = false` on all — no policy is a bare `true`.
- **`using_references_auth = false` and `with_check_references_auth = false` on all six** — no
  policy references `auth.uid()`, `auth.role()`, or `auth.jwt()`.
- `using_references_current_setting = false` on all.

**This is the finding that matters.** The policies are conditional but **not identity-based**.
Whatever they test, it is not who the caller is. Combined with:

- `anon` holding full DML grants,
- the `anon` API key being **hardcoded in two tracked repository scripts**
  (`HARDCODED_ANON_JWT = OPEN`),
- `rls_forced = false`, so the owner bypasses RLS entirely,

the conclusion is that `bolao_state` is effectively **writable by anyone holding the anon key**,
subject only to a non-identity condition. That matches the app's documented local-first design
(the browser writes state directly), so it is *intentional* — but it means **the database
provides no authorisation for the money-bearing table.** Authorisation lives in the client.

- **Duplicate policies (6 where 3 suffice)** — MEDIUM. Permissive policies are OR-ed, so the
  effective grant is the *union*. Two generations of policy stacked means the effective rule is
  broader than either author intended, and reviewing one policy tells you nothing.
- **Policy semantics UNVERIFIED** — flagged `DIRECTED_POLICY_REVIEW_REQUIRED`. The md5 of each
  expression is recorded, so drift is detectable, but the logic has not been read. **This is the
  single highest-value directed review outstanding.**

---

## 3. Expected policies (target posture) vs. missing

| Table | Expected policy set | Present | Gap |
|---|---|---|---|
| `bolao_state` | Identity- or capability-scoped read; write restricted to a server-side path | 6 non-identity permissive | **Authorisation not in DB** |
| `lottery_participants` | Admin-role read/write via `lottery_current_role()`; no `anon` access | 0 (default deny) | Policies declared in `002_rls.sql`, never applied; `lottery_current_role()` absent |
| `lottery_participations` | Admin read/write | 0 | as above |
| `lottery_pools` / `lottery_draws` | Admin write; possibly public read of non-PII projection | 0 | `lottery_public_projection` view never applied |
| `lottery_payment_transactions` | Admin-only; **never** `anon` | 0 | as above; PII+money table |
| `lottery_admin_audit` | Insert-only via SECURITY DEFINER; read admin-only; **no** update/delete for anyone | 0 policies **and** 0 enforcement triggers | **Worst gap** — see R-04 |

### 3.1 Overly permissive, ranked

| # | Finding | Severity | Crossing that establishes it |
|---|---|---|---|
| O-1 | `anon` holds `DELETE` on all 7 tables | HIGH (latent) | Grant exists; neutralised **only** by default-deny RLS on 6 tables and by policy on `bolao_state`. Remove the grant and the protection stops depending on a migration not having run. |
| O-2 | `anon` holds `UPDATE`/`INSERT` on `lottery_payment_transactions` | HIGH (latent) | Same. A payments table should not appear in an `anon` grant list under any posture. |
| O-3 | `service_role` holds full DML **and** `BYPASSRLS` | MEDIUM (by design) | Correct for a server key, but means the service key is a total-access credential. Must never reach a browser. |
| O-4 | `rls_forced = false` on all 7 | MEDIUM | Table owner (`postgres`) bypasses RLS. Fine for migrations, wrong if any application path connects as owner. |
| O-5 | `anon` retains `TRUNCATE` on `storage.buckets`, `storage.buckets_analytics`, `storage.objects` | MEDIUM | Out of scope of the authorised revoke. Mitigated only by there being **0 buckets**. Open decision. |
| O-6 | `MAINTAIN` granted to `anon` (PG17) | LOW | Allows `VACUUM`/`ANALYZE`. Resource nuisance, not data exposure. |
| O-7 | 92 `PUBLIC EXECUTE` grants on functions | LOW | All pgcrypto/`auth` helpers matching the Supabase template; **none** is SECURITY DEFINER. Verified, not assumed. |

### 3.2 What is genuinely clean

Stated for the audit trail, because a review that only lists problems is not a review:

- **`SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH` = 0** across every schema. The highest-severity
  privilege-escalation shape is absent.
- `public` has exactly **1** SECURITY DEFINER function (`rls_auto_enable`), and its `search_path`
  **is** pinned.
- `S21e` default privileges: **0 PUBLIC** entries — objects created tomorrow do not inherit
  PUBLIC exposure.
- `S21f` column-level ACLs: **0** — no hidden column grants.
- `S21b` sequence ACLs: **0 PUBLIC**.
- No table has policies while RLS is off.
- 0 replication slots, 0 subscriptions — the `FOR ALL TABLES` publication has no consumer.

---

## 4. Candidate service boundaries

Derived from the access reality, not invented:

| Boundary | Principal | Should reach | Enforcement mechanism |
|---|---|---|---|
| **Public read surface** | `anon` | Non-PII projections only | Views (`security_invoker = true`) + RLS; **not** direct table grants |
| **Client state write** | `anon` today | `bolao_state` only | Currently unmediated. Target: server-side RPC or Edge Function, so the client stops holding DML. |
| **Admin write path** | authenticated admin | All `lottery_*` | `SECURITY DEFINER` RPCs (the 19 declared, unapplied `admin_*` functions) — the design already exists |
| **Audit append** | RPCs only | `lottery_admin_audit` INSERT | SECURITY DEFINER + trigger-enforced immutability (M-1) |
| **Server jobs** | `service_role` | Everything | API key, never client-side |
| **Migrations/ops** | `postgres` | Everything | Direct connection, human-gated |

**The critical boundary violation today:** `anon` is granted at the *table* level rather than
reaching data through a projection or RPC. Every table in `public` is directly addressable by a
browser key. RLS is the only thing standing between the anon key and the data, and on the one
table where it is policy-governed, the policies are not identity-based.

## 5. Expected ownership model

| Aspect | Current | Expected/target |
|---|---|---|
| Table owner | `postgres` (all 7) | Dedicated non-superuser app owner; `postgres` reserved for migration |
| `bolao_state` policy owner | undeclared | Versioned |
| Schema `public` owner | `pg_database_owner` | Explicit app owner |
| `FORCE RLS` | off everywhere | On for PII/money tables once no app path connects as owner |
| Grant strategy | `GRANT ALL` to `anon`/`authenticated` | Least privilege: `anon` → `SELECT` on views only |
| `CREATE` on database | `postgres`, `dashboard_user`, `supabase_etl_admin`, `supabase_storage_admin` | Reviewed; `dashboard_user` is the notable human path |

---

## 6. Assumptions explicitly retired by this review

1. ~~"RLS protects the data."~~ → It is bypassed by 5 roles and absent as authorisation on the one
   in-use table.
2. ~~"RLS enabled on all 7 tables was a deliberate security decision."~~ → It was produced by an
   undeclared event trigger.
3. ~~"The six lottery tables are secured."~~ → They are default-deny because a migration never
   ran. Correct outcome, accidental cause.
4. ~~"Supabase default grants are safe."~~ → Safe only where policies carry the load.
5. ~~"The audit table is tamper-evident."~~ → Hash columns exist; **no** trigger computes or
   protects them; UPDATE/DELETE are unblocked.
6. ~~"Revoking TRUNCATE from anon closed the destructive-access risk."~~ → Closed it on 7 tables;
   `DELETE` grants remain, and 3 `storage` tables still permit `anon` TRUNCATE.

## 6a. DR-1 — COMPLETED under explicit operator authorization

**Status:** `DR-1 = COMPLETE`. Read-only, no policy changed, no GRANT/REVOKE, no DDL.
**Output discipline:** policy expressions were classified **inside SQL**; the raw expression text was
never returned to the session, printed, or written to any versioned file. No literal, ID, email,
payment reference or secret is reproduced below.

| Policy name | Cmd | Roles | USING | WITH CHECK | `auth.uid` | `auth.role` | `auth.jwt` | Identity-aware | Classification | Sensitive literal |
|---|---|---|---|---|---|---|---|---|---|---|
| `allow anon insert` | INSERT | `{anon}` | NO | YES | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |
| `allow anon upsert bolao state` | INSERT | `{anon}` | NO | YES | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |
| `allow anon read` | SELECT | `{anon}` | YES | NO | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |
| `allow anon read bolao state` | SELECT | `{anon}` | YES | NO | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |
| `allow anon update` | UPDATE | `{anon}` | YES | YES | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |
| `allow anon update bolao state` | UPDATE | `{anon}` | YES | YES | NO | NO | NO | **NO** | `STATIC_CONDITION` | **YES** |

`current_setting` referenced: **NO** on all six. `static_true_present` (bare `true`): **NO** on all
six — so none is unconditional.

### DR-1 findings

**DR1-F1 — There are only TWO distinct predicates, not six.** Expression hashes collapse into two
groups (lengths 19 and 65 characters). One predicate is shared by `allow anon insert` /
`allow anon read` / `allow anon update`; the other by the three `… bolao state`-suffixed policies.
This confirms `T-23`: two generations of policy were applied and the older set was never removed.

**DR1-F2 — Sanitized semantic summary: these are row-scoping allowlists, not authorization.**
Every predicate references the table's `id` column and compares it against embedded literal
value(s); none references any caller attribute. The mechanism restricts **which rows** the `anon`
role may touch — it does not establish **who** the caller is or what they are permitted to do.
Effective authorization mechanism: **`CLIENT_ENFORCED_DEPENDENCY`**. The real access decision (the
admin SHA-256 gate) lives in browser JavaScript; the database enforces only a row allowlist.

**DR1-F3 — Permissive policies OR together, so the effective grant is the union of both
generations.** The two predicates differ in breadth (one is 19 chars, the other 65 and includes a
multi-value comparison). The effective row set for `anon` is therefore the *wider* of the two, and
reviewing either policy in isolation understates access. This is the concrete harm of the duplicate
policies, not a stylistic concern.

**DR1-F4 — NEW: `DELETE` is denied by RLS despite the grant.** No policy covers `DELETE`. Under RLS,
a command with no permissive policy is denied, so `anon`'s `DELETE` grant on `bolao_state` is
currently **inert**. This is a *correction in the reassuring direction* to §3.1 O-1: the `DELETE`
grant is latent rather than live for this table. It remains a finding — the protection depends on a
policy's *absence*, which any future "add a delete policy" change would silently remove — but it is
not presently exploitable. (`TRUNCATE` was the live risk, and it was revoked.)

**DR1-F5 — `SENSITIVE_LITERAL_PRESENT = YES` on all six.** Reported per the strict rule without
value inspection. The literals appear structurally to be row-key identifiers rather than personal
data, but this was **not** verified against the private term lists and must not be assumed benign.

### What DR-1 changes for target RLS design

1. **There is nothing to preserve.** Because no policy is identity-aware, the target RLS model is not
   a refinement of these policies — it is a replacement. No existing authorization semantics are lost
   by redesigning.
2. **Row-allowlist scoping is still useful** and should survive as a defence-in-depth constraint, but
   it must sit *underneath* real authorization rather than substituting for it.
3. **This validates DEC-11 unconditionally.** RLS cannot express "only the admin may write" while the
   admin is not a database principal. Server-mediated writes (Edge Functions, per ratified **E3**)
   are the only mechanism that can carry this authorization.
4. **Collapse six policies to the minimum** and never append a generation again (`NAMING_STANDARDS`
   R2).

## 7. Outstanding directed reviews

| # | Review | Why it cannot be a broad scan |
|---|---|---|
| ~~DR-1~~ | ~~Read the 6 `bolao_state` policy expressions~~ | **DONE — see §6a** |
| DR-2 | Compare applied enum labels against declared | Labels may encode business/PII values. |
| DR-3 | Read `rls_auto_enable()` body | Undeclared SECURITY DEFINER firing on all DDL. |
| DR-4 | Confirm no application path connects as `postgres` | Prerequisite before considering `FORCE RLS`. |
